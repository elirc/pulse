import Redis from "ioredis";
import { RedisEventStream, type RedisLike } from "@pulse/stream";
import { KeyedRateLimiter, assessQuota, type QueuedEvent, type QuotaAssessment } from "@pulse/shared";
import { buildIngestServer, env } from "./server";

// The process entry (not exercised in CI). Wire the production Redis-backed stream; ioredis satisfies the
// structural RedisLike the adapter needs.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const stream = new RedisEventStream<QueuedEvent>(redis as unknown as RedisLike, env.STREAM_KEY, "ingest");

// Per-key token-bucket rate limiter (S13). In-memory per ingest instance; behind N replicas the effective
// per-key rate is N× — acceptable for a pipeline guardrail (a shared Redis bucket would make it global).
const rateLimiter = new KeyedRateLimiter({ capacity: env.RATE_LIMIT_BURST, refillPerSec: env.RATE_LIMIT_PER_SEC });

// Per-project monthly quota (S15). Usage is a Redis counter keyed by project + calendar month; metered from
// ACCEPTED events (onAccepted increments it). A SHARED counter across replicas — unlike the rate limiter, a
// billing allowance must be global, not per-instance.
const usageKey = (projectId: string): string => `pulse:usage:${projectId}:${new Date().toISOString().slice(0, 7)}`;
const quotaCheck = async (projectId: string): Promise<QuotaAssessment> => {
  const used = Number((await redis.get(usageKey(projectId))) ?? 0);
  return assessQuota(used, env.QUOTA_MONTHLY_ALLOWANCE);
};
const onAccepted = (projectId: string, count: number): void => {
  void redis.incrby(usageKey(projectId), count);
};

const app = buildIngestServer({ stream, rateLimiter, quotaCheck, onAccepted });
app
  .listen({ port: env.INGEST_PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`pulse ingest on :${env.INGEST_PORT} — POST /e (enqueue → 202)`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
