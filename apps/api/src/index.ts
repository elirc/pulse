import Redis from "ioredis";
import { RedisEventStream, type RedisLike } from "@pulse/stream";
import { buildApiServer, env, type IngestOps } from "./server";

// Wire ingestion metrics off Redis (not exercised in CI). streamDepth/dlqDepth are XLENs; consumerPending is
// the group's pending-entries count.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const main = new RedisEventStream<unknown>(redis as unknown as RedisLike, env.STREAM_KEY, "api");
const dlq = new RedisEventStream<unknown>(redis as unknown as RedisLike, env.DLQ_KEY, "api");
const ingestOps: IngestOps = {
  streamDepth: () => main.depth(),
  consumerPending: () => main.pending(env.CONSUMER_GROUP),
  dlqDepth: () => dlq.depth(),
};

const app = buildApiServer({ ingestOps });
app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`pulse api on :${env.API_PORT} — GET /ops/ingest for pipeline health`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
