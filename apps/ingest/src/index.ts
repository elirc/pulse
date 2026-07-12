import Redis from "ioredis";
import { RedisEventStream, type RedisLike } from "@pulse/stream";
import { KeyedRateLimiter, type QueuedEvent } from "@pulse/shared";
import { buildIngestServer, env } from "./server";

// The process entry (not exercised in CI). Wire the production Redis-backed stream; ioredis satisfies the
// structural RedisLike the adapter needs.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const stream = new RedisEventStream<QueuedEvent>(redis as unknown as RedisLike, env.STREAM_KEY, "ingest");

// Per-key token-bucket rate limiter (S13). In-memory per ingest instance; behind N replicas the effective
// per-key rate is N× — acceptable for a pipeline guardrail (a shared Redis bucket would make it global).
const rateLimiter = new KeyedRateLimiter({ capacity: env.RATE_LIMIT_BURST, refillPerSec: env.RATE_LIMIT_PER_SEC });

const app = buildIngestServer({ stream, rateLimiter });
app
  .listen({ port: env.INGEST_PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`pulse ingest on :${env.INGEST_PORT} — POST /e (enqueue → 202)`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
