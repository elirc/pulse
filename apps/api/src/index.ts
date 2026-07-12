import Redis from "ioredis";
import { createClient } from "@clickhouse/client";
import { RedisEventStream, type RedisLike } from "@pulse/stream";
import { compileTrendClickhouse, compileFunnelClickhouse, foldTopNRows, type FlatRow, type EventLike } from "@pulse/insights";
import { buildApiServer, env, type IngestOps, type TrendRunner, type FunnelRunner, type EventFetcher } from "./server";

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

// ClickHouse funnel backend (S08): windowFunnel() → per-step counts → FunnelResult.
const chFunnel: FunnelRunner = async (spec, projectId) => {
  const { text, params } = compileFunnelClickhouse(spec, projectId);
  const rs = await ch.query({ query: text, query_params: params, format: "JSONEachRow" });
  const rows = (await rs.json()) as Array<Record<string, string | number>>;
  const row = rows[0] ?? {};
  const counts = spec.steps.map((_, i) => Number(row[`step${i + 1}`] ?? 0));
  const start = counts[0];
  return {
    steps: spec.steps.map((s, i) => ({
      step: i + 1,
      event: s.event,
      count: counts[i],
      conversionFromStart: start === 0 ? 0 : counts[i] / start,
      conversionFromPrev: i === 0 ? 1 : counts[i - 1] === 0 ? 0 : counts[i] / counts[i - 1],
    })),
    medianTimeToConvertMs: null, // a separate quantile() query would fill these; deferred
    p90TimeToConvertMs: null,
  };
};

// Event fetcher for retention (S09): pull recent events from ClickHouse; the grid is computed in-memory.
const chEvents: EventFetcher = async (projectId, days) => {
  const rs = await ch.query({
    query:
      "SELECT name, distinctId, personId, toUnixTimestamp64Milli(ts) AS tsMs FROM events " +
      "WHERE projectId = {pid:String} AND ts >= now() - toIntervalDay({days:UInt16})",
    query_params: { pid: projectId, days },
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{ name: string; distinctId: string; personId: string; tsMs: string | number }>;
  return rows.map<EventLike>((r) => ({
    name: r.name,
    distinctId: r.distinctId,
    personId: r.personId || null,
    props: {},
    ts: new Date(Number(r.tsMs)),
  }));
};

const app = buildApiServer({ ingestOps, chTrend, chFunnel, chEvents, readFromClickhouse: env.READ_FROM_CH });
app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`pulse api on :${env.API_PORT} — reads ${env.READ_FROM_CH ? "ClickHouse" : "Postgres"}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
