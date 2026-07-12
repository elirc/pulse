import Redis from "ioredis";
import { createClient } from "@clickhouse/client";
import { RedisEventStream, type RedisLike } from "@pulse/stream";
import { compileTrendClickhouse, foldTopNRows, type FlatRow } from "@pulse/insights";
import { buildApiServer, env, type IngestOps, type TrendRunner } from "./server";

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

// ClickHouse trend backend (S07): compile the same TrendSpec to CH SQL and run it. Used by /insights/trend/verify
// always, and by /insights/trend once READ_FROM_CH flips.
const ch = createClient({ url: env.CLICKHOUSE_URL, database: env.CLICKHOUSE_DB });
const chTrend: TrendRunner = async (spec, projectId) => {
  const { text, params } = compileTrendClickhouse(spec, projectId);
  const rs = await ch.query({ query: text, query_params: params, format: "JSONEachRow" });
  const rows = (await rs.json()) as Array<{ bucket: string; label?: string; value: string | number }>;
  const flat: FlatRow[] = rows.map((r) => ({ bucket: r.bucket, label: r.label ?? null, value: Number(r.value) }));
  return spec.breakdown ? foldTopNRows(flat, spec.topN) : flat;
};

const app = buildApiServer({ ingestOps, chTrend, readFromClickhouse: env.READ_FROM_CH });
app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`pulse api on :${env.API_PORT} — reads ${env.READ_FROM_CH ? "ClickHouse" : "Postgres"}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
