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
import { ConcurrencyLimiter, InMemoryCacheStore, type QueuedEvent } from "@pulse/shared";
import { prisma } from "@pulse/db";
import type { VariantCount } from "@pulse/flags";
import type { DeletionLedgerPort, DeletionPorts, DeletionRequest } from "./deletion";

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

// Experiment exposure→goal counts per variant (S14): the funnel behind results. For each variant, distinct
// exposed persons ($flag_evaluated for this flag+variant) and how many later did the goal event. The z-test math
// lives in @pulse/flags; this just supplies the counts.
const experimentCounts = async (experimentId: string, projectId: string): Promise<VariantCount[]> => {
  const exp = await prisma.experiment.findUnique({
    where: { id: experimentId },
    select: { goalEvent: true, flag: { select: { key: true, variants: true } } },
  });
  if (!exp) return [];
  const variants = (exp.flag.variants as Array<{ key: string }>).map((v) => v.key);
  const out: VariantCount[] = [];
  for (const variant of variants) {
    const rs = await ch.query({
      query:
        "WITH exposed AS (" +
        "  SELECT if(personId != '', personId, distinctId) AS person, min(ts) AS firstExp FROM events" +
        "  WHERE projectId = {pid:String} AND name = '$flag_evaluated'" +
        "    AND JSONExtractString(props,'$flag_key') = {fk:String}" +
        "    AND JSONExtractString(props,'$variant') = {v:String} GROUP BY person)," +
        " goal AS (" +
        "  SELECT if(personId != '', personId, distinctId) AS person, min(ts) AS goalTs FROM events" +
        "  WHERE projectId = {pid:String} AND name = {goal:String} GROUP BY person) " +
        "SELECT count() AS exposed, countIf(g.goalTs >= e.firstExp) AS converted " +
        "FROM exposed e LEFT JOIN goal g ON e.person = g.person",
      query_params: { pid: projectId, fk: exp.flag.key, v: variant, goal: exp.goalEvent },
      format: "JSONEachRow",
    });
    const row = ((await rs.json()) as Array<{ exposed: string | number; converted: string | number }>)[0];
    out.push({ variant, exposed: Number(row?.exposed ?? 0), converted: Number(row?.converted ?? 0) });
  }
  return out;
};

// GDPR deletion ports (S13). Deletion is a background sweep across every store with a count-to-zero verify.
// The cache is single-instance in-memory here (also handed to the server) so a person delete can flush it.
const cacheStore = new InMemoryCacheStore();
const toReq = (r: {
  id: string;
  personId: string;
  status: string;
  distinctIds: string[];
  rowsDeleted: number | null;
  remaining: number | null;
  requestedAt: Date;
  completedAt: Date | null;
}): DeletionRequest => ({
  id: r.id,
  personId: r.personId,
  status: r.status as DeletionRequest["status"],
  distinctIds: r.distinctIds,
  rowsDeleted: r.rowsDeleted ?? undefined,
  remaining: r.remaining ?? undefined,
  requestedAt: r.requestedAt.toISOString(),
  completedAt: r.completedAt?.toISOString(),
});
const prismaDeletionLedger: DeletionLedgerPort = {
  async create(req) {
    await prisma.deletionRequest.create({
      data: { id: req.id, personId: req.personId, status: req.status, distinctIds: req.distinctIds, requestedAt: new Date(req.requestedAt) },
    });
  },
  async update(id, patch) {
    await prisma.deletionRequest.update({
      where: { id },
      data: {
        status: patch.status,
        rowsDeleted: patch.rowsDeleted,
        remaining: patch.remaining,
        completedAt: patch.completedAt ? new Date(patch.completedAt) : undefined,
      },
    });
  },
  async get(id) {
    const r = await prisma.deletionRequest.findUnique({ where: { id } });
    return r ? toReq(r) : null;
  },
  async list() {
    const rs = await prisma.deletionRequest.findMany({ orderBy: { requestedAt: "desc" } });
    return rs.map(toReq);
  },
};
const deletionPorts: DeletionPorts = {
  async resolveDistinctIds(personId) {
    const rows = await prisma.distinctIdMapping.findMany({ where: { personId }, select: { distinctId: true } });
    return rows.map((r) => r.distinctId);
  },
  async deleteMetadata(personId) {
    // Hard-delete every Postgres copy in one transaction: cohort memberships, id mappings, the person row.
    await prisma.$transaction([
      prisma.cohortMembership.deleteMany({ where: { personId } }),
      prisma.distinctIdMapping.deleteMany({ where: { personId } }),
      prisma.person.deleteMany({ where: { id: personId } }),
    ]);
  },
  async deleteEvents(distinctIds) {
    if (distinctIds.length === 0) return 0;
    // ClickHouse lightweight delete — a background mutation, not a row op. Cheap to issue, async to apply.
    await ch.command({ query: "DELETE FROM events WHERE distinctId IN {ids:Array(String)}", query_params: { ids: distinctIds } });
    return distinctIds.length; // best-effort; the verify step is the real proof
  },
  async flushCaches() {
    await cacheStore.clear?.();
  },
  async countRemaining(distinctIds) {
    if (distinctIds.length === 0) return 0;
    const rs = await ch.query({
      query: "SELECT count() AS n FROM events WHERE distinctId IN {ids:Array(String)}",
      query_params: { ids: distinctIds },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{ n: string | number }>;
    return Number(rows[0]?.n ?? 0);
  },
  ledger: prismaDeletionLedger,
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
  cacheStore,
  deletionPorts,
  experimentCounts,
  // Quota metering dashboard (S15): read the same Redis monthly counter ingest advances (accepted counts).
  quotaUsage: async (projectId: string) => {
    const key = `pulse:usage:${projectId}:${new Date().toISOString().slice(0, 7)}`;
    const used = Number((await redis.get(key)) ?? 0);
    return { used, allowance: env.QUOTA_MONTHLY_ALLOWANCE };
  },
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
