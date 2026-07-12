import Redis from "ioredis";
import { RedisEventStream, type RedisLike } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { PrismaEventStore } from "./store";
import { StreamDeadLetterQueue, type DeadLetterRecord } from "./dlq";
import { createClient } from "@clickhouse/client";
import { prisma } from "@pulse/db";
import { IdentityResolver } from "./identity";
import { PrismaPersonStore } from "./personstore";
import { PrismaAdvisoryLocker } from "./locker";
import { Sessionizer, RedisSessionStore, type RedisKV } from "./session";
import { BufferedColumnStore, ClickHouseColumnStore, type ClickHouseLike, type ColumnStore } from "./columnstore";
import { processNewBatch, processPendingBatch } from "./worker";
import { GracefulShutdown, runConsumerLoop } from "./shutdown";
import { env } from "./env";

// The process entry (not exercised in CI): wire Redis + Prisma and loop forever, draining pending work first.
async function main(): Promise<void> {
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const stream = new RedisEventStream<QueuedEvent>(
    redis as unknown as RedisLike,
    env.STREAM_KEY,
    env.CONSUMER_NAME,
  );
  const dlqStream = new RedisEventStream<DeadLetterRecord>(
    redis as unknown as RedisLike,
    env.DLQ_KEY,
    env.CONSUMER_NAME,
  );
  const dlq = new StreamDeadLetterQueue(dlqStream);
  const resolver = new IdentityResolver(new PrismaPersonStore(), { locker: new PrismaAdvisoryLocker(prisma) });

  // Postgres events store — the source of truth UNTIL decommission. After EVENTS_PRIMARY flips to 'ch', we stop
  // writing PG events entirely (the table is archived); ClickHouse becomes truth.
  const store = env.EVENTS_PRIMARY === "pg" ? new PrismaEventStore() : undefined;

  // ClickHouse: a shadow during dual-write, the source of truth once PG is decommissioned.
  let columnStore: ColumnStore | undefined;
  if (env.DUAL_WRITE || env.EVENTS_PRIMARY === "ch") {
    const ch = createClient({ url: env.CLICKHOUSE_URL, database: env.CLICKHOUSE_DB });
    columnStore = new BufferedColumnStore(new ClickHouseColumnStore(ch as unknown as ClickHouseLike));
    console.log(env.EVENTS_PRIMARY === "ch" ? "ClickHouse is PRIMARY (PG decommissioned)" : "dual-write ON — CH shadow");
  }

  const sessionizer = new Sessionizer(new RedisSessionStore(redis as unknown as RedisKV));
  const deps = { stream, store, dlq, resolver, columnStore, sessionizer, group: env.CONSUMER_GROUP, batchSize: env.BATCH_SIZE };

  await stream.ensureGroup(env.CONSUMER_GROUP);
  console.log(`pulse consumer '${env.CONSUMER_NAME}' on group '${env.CONSUMER_GROUP}'`);

  // Graceful shutdown (S15): SIGTERM (from the orchestrator on deploy) → drain. The loop finishes its in-flight
  // batch and XACKs it, then exits cleanly, so a rollover doesn't strand a pending list for the next consumer.
  const shutdown = new GracefulShutdown();
  const onSignal = (): void => {
    console.log("shutdown requested — draining in-flight batch, then exiting");
    shutdown.requestDrain();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  // Recover this consumer's un-acked backlog from a prior crash, then poll new work until drained.
  while ((await processPendingBatch(deps)) > 0);
  await runConsumerLoop(async () => {
    const n = await processNewBatch(deps);
    if (n === 0) await new Promise((r) => setTimeout(r, 200)); // idle poll
    return n;
  }, shutdown);
  console.log("consumer drained; exiting for a clean rollover");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
