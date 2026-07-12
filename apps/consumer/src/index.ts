import Redis from "ioredis";
import { RedisEventStream, type RedisLike } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { PrismaEventStore } from "./store";
import { StreamDeadLetterQueue, type DeadLetterRecord } from "./dlq";
import { prisma } from "@pulse/db";
import { IdentityResolver } from "./identity";
import { PrismaPersonStore } from "./personstore";
import { PrismaAdvisoryLocker } from "./locker";
import { processNewBatch, processPendingBatch } from "./worker";
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
  const store = new PrismaEventStore();
  const dlq = new StreamDeadLetterQueue(dlqStream);
  const resolver = new IdentityResolver(new PrismaPersonStore(), { locker: new PrismaAdvisoryLocker(prisma) });
  const deps = { stream, store, dlq, resolver, group: env.CONSUMER_GROUP, batchSize: env.BATCH_SIZE };

  await stream.ensureGroup(env.CONSUMER_GROUP);
  console.log(`pulse consumer '${env.CONSUMER_NAME}' on group '${env.CONSUMER_GROUP}'`);

  // Recover this consumer's un-acked backlog from a prior crash, then poll new work.
  while ((await processPendingBatch(deps)) > 0);
  for (;;) {
    const n = await processNewBatch(deps);
    if (n === 0) await new Promise((r) => setTimeout(r, 200)); // idle poll
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
