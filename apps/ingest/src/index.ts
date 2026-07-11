import Redis from "ioredis";
import { RedisEventStream, type RedisLike } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { buildIngestServer, env } from "./server";

// The process entry (not exercised in CI). Wire the production Redis-backed stream; ioredis satisfies the
// structural RedisLike the adapter needs.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const stream = new RedisEventStream<QueuedEvent>(redis as unknown as RedisLike, env.STREAM_KEY, "ingest");

const app = buildIngestServer({ stream });
app
  .listen({ port: env.INGEST_PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`pulse ingest on :${env.INGEST_PORT} — POST /e (enqueue → 202)`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
