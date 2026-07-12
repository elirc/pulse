import Redis from "ioredis";
import { createClient } from "@clickhouse/client";
import { RedisEventStream, type RedisLike } from "@pulse/stream";
import {
  compileTrendClickhouse,
  compileTrendRollup,
  isRollupEligible,
  compileFunnelClickhouse,
  foldTopNRows,
  type FlatRow,
  type EventLike,
  type TrendSpec,
} from "@pulse/insights";
import {
  buildApiServer,
  env,
  type IngestOps,
  type TrendRunner,
  type FunnelRunner,
  type EventFetcher,
  type QueryCostEvent,
} from "./server";
import { resolveCohortMembers } from "./cohorts";
import { TailHub } from "./tail";
import { OnlineWindow, RedisSortedSetStore, type RedisZ } from "./online";
import { ConcurrencyLimiter, type QueuedEvent } from "@pulse/shared";

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

// Live tail (S11): a dedicated fan-out consumer group reads the ingest stream and feeds the hub. Its own group,
// so tail readers never touch the insert consumer's pending list.
const tailHub = new TailHub();
const onlineWindow = new OnlineWindow(new RedisSortedSetStore(redis as unknown as RedisZ));
const tailStream = new RedisEventStream<QueuedEvent>(redis as unknown as RedisLike, env.STREAM_KEY, "tail");
void (async () => {
  await tailStream.ensureGroup("tail");
  for (;;) {
    const entries = await tailStream.readNew("tail", 500);
    for (const e of entries) {
      tailHub.push(e.data);
      void onlineWindow.seen(e.data.projectId, e.data.distinctId, Date.now()); // mark active for online-now
    }
    await tailStream.ack(
      "tail",
      entries.map((e) => e.id),
    );
    if (entries.length === 0) await new Promise((r) => setTimeout(r, 200));
  }
})();

// ClickHouse trend backend (S07): compile the same TrendSpec to CH SQL and run it. Used by /insights/trend/verify
// always, and by /insights/trend once READ_FROM_CH flips.
// max_execution_time (S12): a hard server-side cap so a runaway scan can't hold a slot forever. Applied to every
// analytical read; ClickHouse aborts the query at the limit rather than letting it consume the cluster.
const ch = createClient({
  url: env.CLICKHOUSE_URL,
  database: env.CLICKHOUSE_DB,
  clickhouse_settings: { max_execution_time: env.MAX_QUERY_SECONDS },
});
const chTrend: TrendRunner = async (spec, projectId) => {
  // Transparent rollup routing (S12): eligible daily count/unique queries read the pre-aggregated rollup.
  const { text, params } = isRollupEligible(spec)
    ? compileTrendRollup(spec, projectId)
    : compileTrendClickhouse(spec, projectId);
  const rs = await ch.query({ query: text, query_params: params, format: "JSONEachRow" });
  const rows = (await rs.json()) as Array<{ bucket: string; label?: string; value: string | number }>;
  const flat: FlatRow[] = rows.map((r) => ({ bucket: r.bucket, label: r.label ?? null, value: Number(r.value) }));
  return spec.breakdown ? foldTopNRows(flat, spec.topN) : flat;
};

// Sampled trend backend (S12): the same CH query with SAMPLE {rate}. Never routes to the rollup (rollups are
// already exact and cheap; sampling is for the raw path). The endpoint scales the counts and attaches CIs.
const chTrendSampled = async (spec: TrendSpec, projectId: string, sampleRate: number): Promise<FlatRow[]> => {
  const { text, params } = compileTrendClickhouse(spec, projectId, { sampleRate });
  const rs = await ch.query({ query: text, query_params: params, format: "JSONEachRow" });
  const rows = (await rs.json()) as Array<{ bucket: string; label?: string; value: string | number }>;
  const flat: FlatRow[] = rows.map((r) => ({ bucket: r.bucket, label: r.label ?? null, value: Number(r.value) }));
  return spec.breakdown ? foldTopNRows(flat, spec.topN) : flat;
};

// Approximate distinct count of a property (S12): powers the cardinality guard. uniq() is a cheap HLL estimate.
const cardinalityOf = async (property: string, projectId: string): Promise<number> => {
  const rs = await ch.query({
    query:
      "SELECT uniq(JSONExtractString(props, {prop:String})) AS n FROM events " +
      "WHERE projectId = {pid:String} AND ts >= now() - toIntervalDay(30)",
    query_params: { prop: property, pid: projectId },
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{ n: string | number }>;
  return Number(rows[0]?.n ?? 0);
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

// Per-project concurrency cap + cost telemetry (S12). The limiter is in-memory per API instance; behind N
// replicas the effective cap is N×, which is fine — it's a guardrail against a single tenant's runaway
// dashboard, not a global quota. onQueryCost logs structured cost lines a metrics pipeline can scrape.
const queryLimiter = new ConcurrencyLimiter(env.MAX_QUERY_CONCURRENCY);
const onQueryCost = (e: QueryCostEvent): void => {
  console.log(
    JSON.stringify({ at: "query.cost", ...e }),
  );
};

const app = buildApiServer({
  ingestOps,
  chTrend,
  chTrendSampled,
  cardinalityOf,
  chFunnel,
  chEvents,
  cohortMembers: resolveCohortMembers,
  tailHub,
  onlineWindow,
  queryLimiter,
  onQueryCost,
  readFromClickhouse: env.READ_FROM_CH,
});
app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`pulse api on :${env.API_PORT} — reads ${env.READ_FROM_CH ? "ClickHouse" : "Postgres"}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
