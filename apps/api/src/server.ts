import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { z, ZodError } from "zod";
import { prisma, PrismaKeyStore } from "@pulse/db";
import { CachedKeyResolver, keyCan } from "@pulse/auth";
import {
  TrendSpecSchema,
  FunnelSpecSchema,
  compileTrendSql,
  foldTopNRows,
  computeRetention,
  routeTrend,
  UNIQ_RELATIVE_ERROR,
  type FlatRow,
  type TrendSpec,
  type FunnelSpec,
  type FunnelResult,
  type RetentionResult,
  type EventLike,
} from "@pulse/insights";
import { z as zod } from "zod";

/** Fetches events for a project over a lookback window (from ClickHouse) — the "big scan" retention reads. */
export type EventFetcher = (projectId: string, days: number) => Promise<EventLike[]>;

const RetentionBody = zod.object({
  projectId: zod.string().min(1).default("demo-project"),
  /** Optional cohort filter (S09): restrict retention to this cohort's members. */
  cohort: zod.string().min(1).optional(),
  spec: zod.object({
    startEvent: zod.string().min(1).max(200).optional(),
    returnEvent: zod.string().min(1).max(200).optional(),
    granularity: zod.enum(["day", "week"]).default("week"),
    periods: zod.number().int().min(1).max(52).default(8),
    days: zod.number().int().min(1).max(365).default(56),
  }),
});
import { canonicalHash, ResultCache, InMemoryCacheStore, type CacheStore, type DailyCount } from "@pulse/shared";
import { env } from "./env";
import { requireSession } from "./auth";
import { resolveKey } from "./keyauth";
import { assertProjectInOrg, issueKey, listKeys } from "./keys";
import { createCohort, listCohorts } from "./cohorts";
import { createShareToken, resolveShareToken } from "./share";
import { TailHub } from "./tail";
import { OnlineWindow } from "./online";
import { randomUUID } from "node:crypto";
import { CohortSpecSchema } from "@pulse/insights";

const CohortBody = zod.object({
  projectId: zod.string().min(1).default("demo-project"),
  name: zod.string().min(1).max(200),
  definition: CohortSpecSchema,
});

/** Operational metrics for the ingestion pipeline — the numbers become an operational surface (S15 alerts here). */
export interface IngestOps {
  streamDepth(): Promise<number>;
  consumerPending(): Promise<number>;
  dlqDepth(): Promise<number>;
}

/** Runs a compiled trend query against a backend, returning flat rows. */
export type TrendRunner = (spec: TrendSpec, projectId: string) => Promise<FlatRow[]>;
/** Runs a funnel against a backend (ClickHouse windowFunnel), returning the funnel result. */
export type FunnelRunner = (spec: FunnelSpec, projectId: string) => Promise<FunnelResult>;

export interface ApiServerOptions {
  /** Injectable so CI resolves keys against an in-memory store; production defaults to Prisma. */
  resolver?: CachedKeyResolver;
  /** Ingestion pipeline metrics source; wired to Redis in production, an in-memory fake in tests. */
  ingestOps?: IngestOps;
  /** Live-tail fan-out hub (S11) — fed by a dedicated tail consumer group in the entry. */
  tailHub?: TailHub;
  /** "Online now" sliding-window counter (S11). */
  onlineWindow?: OnlineWindow;
  /** ClickHouse trend backend (S07). When present + readFromClickhouse, trends read CH; verify runs both. */
  chTrend?: TrendRunner;
  /** ClickHouse funnel backend (S08). Funnels run as windowFunnel() queries. */
  chFunnel?: FunnelRunner;
  /** Event fetcher for retention (S09) — the big scan retention reads, then the grid is computed in-memory. */
  chEvents?: EventFetcher;
  /** Resolve a cohort's members (S09) — property live / behavioral materialized. Used to filter any query. */
  cohortMembers?: (cohortId: string, projectId: string) => Promise<Set<string>>;
  /** Tile result cache store (S10) — Redis in prod, in-memory in tests. */
  cacheStore?: CacheStore;
  /** Read cutover flag (S07): serve trends from ClickHouse instead of Postgres. */
  readFromClickhouse?: boolean;
}

const IssueKeyBody = z.object({
  type: z.enum(["WRITE", "SECRET"]),
  label: z.string().max(100).default(""),
});

const TrendBody = z.object({
  projectId: z.string().min(1).default("demo-project"),
  spec: TrendSpecSchema,
});

const SaveInsightBody = z.object({
  projectId: z.string().min(1).default("demo-project"),
  name: z.string().min(1).max(200),
  definition: TrendSpecSchema,
});

/** One flat row of a compiled trend query. */
interface TrendRow {
  bucket: string;
  label?: string;
  value: bigint;
}

/**
 * The app API (S01) — the ANALYST-facing surface, deployed separately from ingest (ADR-0001). Dashboards and
 * insight queries live here; they can be slow and heavy without ever touching the ingest hot path. In S01 the
 * only insight is a daily count — the first, simplest aggregation over the event firehose.
 */
export function buildApiServer(opts: ApiServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" ? { level: "info" } : false });
  void app.register(cors, { origin: env.WEB_URL });

  const resolver = opts.resolver ?? new CachedKeyResolver(new PrismaKeyStore());
  const resultCache = new ResultCache(opts.cacheStore ?? new InMemoryCacheStore());

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      void reply.code(400).send({ error: { code: "VALIDATION", message: "Invalid request" } });
      return;
    }
    void reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });

  app.get("/health", async () => ({ status: "ok" }));

  /**
   * Live event tail (S11): Server-Sent Events from a dedicated fan-out group (wired in the entry). Replaces the
   * S05 raw-table polling feed. A slow client gets a bounded ring buffer that DROPS old frames (freshness >
   * completeness) and reports the drop count — it never back-pressures the pipeline.
   */
  app.get<{ Querystring: { projectId?: string; event?: string; distinctId?: string } }>("/events/tail", (req, reply) => {
    const hub = opts.tailHub;
    if (!hub) {
      void reply.code(503).send({ error: { code: "UNCONFIGURED", message: "Live tail not wired" } });
      return;
    }
    const id = randomUUID();
    hub.subscribe(id, { projectId: req.query.projectId, event: req.query.event, distinctId: req.query.distinctId });
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const timer = setInterval(() => {
      const frame = hub.drain(id);
      if (frame.events.length > 0 || frame.dropped > 0) reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
    }, 500);
    req.raw.on("close", () => {
      clearInterval(timer);
      hub.unsubscribe(id);
    });
  });

  /**
   * Ingestion pipeline health (S04): stream backlog, consumer pending (in-flight, unacked), and DLQ size.
   * Making the pipeline's numbers a queryable surface is what lets S15 alert on them ("consumer lag > N for
   * M minutes") instead of discovering a backlog from angry customers.
   */
  app.get("/ops/ingest", async (_req, reply) => {
    if (!opts.ingestOps) {
      return reply.code(503).send({ error: { code: "UNCONFIGURED", message: "Ingest metrics not wired" } });
    }
    const [streamDepth, consumerPending, dlqDepth] = await Promise.all([
      opts.ingestOps.streamDepth(),
      opts.ingestOps.consumerPending(),
      opts.ingestOps.dlqDepth(),
    ]);
    return { streamDepth, consumerPending, dlqDepth };
  });

  /**
   * Issue a key for a project (S02). Human action → requires a SESSION, not a key. The plaintext is in the
   * response body exactly once; after this handler returns, only its hash exists anywhere. 201 with a loud
   * warning so the caller knows there is no second chance.
   */
  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/projects/:projectId/keys",
    { preHandler: requireSession },
    async (req, reply) => {
      const body = IssueKeyBody.parse(req.body);
      const session = req.session!; // requireSession guarantees this
      if (!(await assertProjectInOrg(req.params.projectId, session.orgId))) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Project not found" } });
      }
      const issued = await issueKey(req.params.projectId, body.type, body.label);
      return reply.code(201).send({
        id: issued.id,
        type: issued.type,
        prefix: issued.prefix,
        key: issued.plaintext,
        warning: "This is the only time the key is shown. Store it now — we keep only a hash.",
      });
    },
  );

  /** List a project's keys (prefixes only — never the secret). */
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/keys",
    { preHandler: requireSession },
    async (req, reply) => {
      const session = req.session!;
      if (!(await assertProjectInOrg(req.params.projectId, session.orgId))) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Project not found" } });
      }
      return listKeys(req.params.projectId);
    },
  );

  /**
   * Read a project's recent events (S02). Authenticated by an API key AND gated on the read capability: a
   * WRITE key (public, in page source) may only append, so it is denied here before any query runs. Resolving
   * a key proves it is real; keyCan proves it is allowed. See @pulse/auth/capability.ts and ADR-0003.
   */
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/events", async (req, reply) => {
    const resolved = await resolveKey(req, resolver);
    if (!resolved) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "API key required" } });
    }
    if (!keyCan(resolved.type, "read")) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "This key type may not read events" } });
    }
    if (resolved.projectId !== req.params.projectId) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Key does not match project" } });
    }
    const events = await prisma.event.findMany({
      where: { projectId: resolved.projectId },
      orderBy: { ts: "desc" },
      take: 100,
      select: { id: true, name: true, distinctId: true, ts: true, ingestedAt: true },
    });
    return events;
  });

  /**
   * Trend query (S05): compile a validated TrendSpec to parameterized SQL and run it. The spec is a closed AST
   * (see @pulse/insights) — user input reaches the query only as bound params, never as SQL text. Returns flat
   * { bucket, label, value } rows; the web pivots them into a chart. (Analyst-facing; auth hardening later.)
   */
  /** Run a trend against Postgres (compile → parameterized SQL → query → fold top-N). */
  const runTrendPg: TrendRunner = async (spec, projectId) => {
    const { text, params } = compileTrendSql(spec, projectId);
    const rows = await prisma.$queryRawUnsafe<TrendRow[]>(text, ...params);
    const flat: FlatRow[] = rows.map((r) => ({ bucket: r.bucket, label: r.label ?? null, value: Number(r.value) }));
    return spec.breakdown ? foldTopNRows(flat, spec.topN) : flat;
  };

  app.post<{ Body: unknown }>("/insights/trend", async (req, reply) => {
    const body = TrendBody.parse(req.body);
    // Read cutover (S07): serve from ClickHouse once the flag flips; Postgres until then.
    const runner = opts.readFromClickhouse && opts.chTrend ? opts.chTrend : runTrendPg;
    // Transparent-routing debug header (S12): which path served this query, so a routed query is auditable.
    void reply.header("x-served-by", opts.readFromClickhouse && opts.chTrend ? routeTrend(body.spec) : "postgres");
    return runner(body.spec, body.projectId);
  });

  /**
   * Live-verify (S07): run the same trend on BOTH engines and return them side by side with a per-bucket
   * drift/tolerance check — the soak-week page that proves parity in production before and after cutover. Count
   * drift must be zero; unique drift is allowed within uniq()'s documented error bound.
   */
  app.post<{ Body: unknown }>("/insights/trend/verify", async (req, reply) => {
    const body = TrendBody.parse(req.body);
    if (!opts.chTrend) {
      return reply.code(503).send({ error: { code: "UNCONFIGURED", message: "ClickHouse backend not wired" } });
    }
    const [pg, ch] = await Promise.all([runTrendPg(body.spec, body.projectId), opts.chTrend(body.spec, body.projectId)]);
    // Index each side by (bucket, label) via nested maps — no fragile separator, no control chars.
    const index = (rows: FlatRow[]): Map<string, Map<string, number>> => {
      const m = new Map<string, Map<string, number>>();
      for (const r of rows) {
        let byLabel = m.get(r.bucket);
        if (!byLabel) m.set(r.bucket, (byLabel = new Map()));
        byLabel.set(r.label ?? "", r.value);
      }
      return m;
    };
    const pgIdx = index(pg);
    const chIdx = index(ch);
    const drift: Array<{ bucket: string; label: string | null; pg: number; ch: number }> = [];
    for (const bucket of new Set([...pgIdx.keys(), ...chIdx.keys()])) {
      const labels = new Set([...(pgIdx.get(bucket)?.keys() ?? []), ...(chIdx.get(bucket)?.keys() ?? [])]);
      for (const label of labels) {
        const p = pgIdx.get(bucket)?.get(label) ?? 0;
        const c = chIdx.get(bucket)?.get(label) ?? 0;
        const tolerance = body.spec.metric === "unique" ? Math.ceil(p * UNIQ_RELATIVE_ERROR) : 0;
        if (Math.abs(p - c) > tolerance) drift.push({ bucket, label: label || null, pg: p, ch: c });
      }
    }
    return { pg, ch, drift, ok: drift.length === 0 };
  });

  /**
   * Retention (S09): computed ON READ. Fetch the project's recent events (the big scan) and compute the cohort
   * grid in memory (the small output). Deliberately not materialized — analysts want it fresh (ADR-0008).
   */
  app.post<{ Body: unknown }>("/insights/retention", async (req, reply): Promise<RetentionResult | undefined> => {
    const body = RetentionBody.parse(req.body);
    if (!opts.chEvents) {
      void reply.code(503).send({ error: { code: "UNCONFIGURED", message: "Event source not wired" } });
      return undefined;
    }
    let events = await opts.chEvents(body.projectId, body.spec.days);
    // Cohort filter (S09): the same membership resolver every query path shares.
    if (body.cohort && opts.cohortMembers) {
      const members = await opts.cohortMembers(body.cohort, body.projectId);
      events = events.filter((e) => members.has(e.personId ?? e.distinctId));
    }
    return computeRetention(events, body.spec);
  });

  /**
   * A saved insight's CACHED result (S10) — a dashboard tile. Keyed on the query DEFINITION hash (not the URL),
   * single-flight against the stampede, `computedAt` returned so the UI can show staleness. `?refresh=1` forces
   * a recompute (the manual refresh button).
   */
  app.get<{ Params: { insightId: string }; Querystring: { refresh?: string } }>(
    "/insights/:insightId/result",
    async (req, reply) => {
      const insight = await prisma.insight.findUnique({
        where: { id: req.params.insightId },
        select: { defKind: true, definition: true, defVersion: true, projectId: true },
      });
      if (!insight) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Insight not found" } });

      const key = canonicalHash({ id: req.params.insightId, kind: insight.defKind, def: insight.definition, v: insight.defVersion });
      return resultCache.getOrCompute(
        key,
        async () => {
          if (insight.defKind === "funnel" && opts.chFunnel) {
            return opts.chFunnel(FunnelSpecSchema.parse(insight.definition), insight.projectId);
          }
          const spec = TrendSpecSchema.parse(insight.definition);
          const runner = opts.readFromClickhouse && opts.chTrend ? opts.chTrend : runTrendPg;
          return runner(spec, insight.projectId);
        },
        req.query.refresh === "1",
      );
    },
  );

  /** Funnel query (S08): ordered-step conversion via ClickHouse windowFunnel(). */
  app.post<{ Body: unknown }>("/insights/funnel", async (req, reply) => {
    const body = z.object({ projectId: z.string().min(1).default("demo-project"), spec: FunnelSpecSchema }).parse(req.body);
    if (!opts.chFunnel) {
      return reply.code(503).send({ error: { code: "UNCONFIGURED", message: "ClickHouse funnel backend not wired" } });
    }
    return opts.chFunnel(body.spec, body.projectId);
  });

  /** Create a dashboard (S10). */
  app.post<{ Body: unknown }>("/dashboards", async (req, reply) => {
    const body = zod.object({ projectId: zod.string().min(1).default("demo-project"), name: zod.string().min(1).max(200) }).parse(req.body);
    const row = await prisma.dashboard.create({ data: { projectId: body.projectId, name: body.name }, select: { id: true } });
    return reply.code(201).send({ id: row.id });
  });

  /** Add a tile (an insight ref + grid position) to a dashboard. */
  app.post<{ Params: { dashboardId: string }; Body: unknown }>("/dashboards/:dashboardId/tiles", async (req, reply) => {
    const body = zod
      .object({ insightId: zod.string().min(1), x: zod.number().int().default(0), y: zod.number().int().default(0), w: zod.number().int().default(4), h: zod.number().int().default(3) })
      .parse(req.body);
    const row = await prisma.dashboardTile.create({ data: { dashboardId: req.params.dashboardId, ...body }, select: { id: true } });
    return reply.code(201).send({ id: row.id });
  });

  /** Create a public share token for a dashboard (S10) — shown once. Requires a session (a human action). */
  app.post<{ Params: { dashboardId: string } }>(
    "/dashboards/:dashboardId/share",
    { preHandler: requireSession },
    async (req, reply) => {
      const issued = await createShareToken(req.params.dashboardId);
      return reply.code(201).send({ token: issued.token, prefix: issued.prefix, warning: "Shown once. Anyone with this link can view the dashboard." });
    },
  );

  /** A dashboard with its tiles (for rendering). */
  app.get<{ Params: { dashboardId: string } }>("/dashboards/:dashboardId", async (req, reply) => {
    const dash = await prisma.dashboard.findUnique({
      where: { id: req.params.dashboardId },
      select: { id: true, name: true, tiles: { select: { id: true, insightId: true, x: true, y: true, w: true, h: true } } },
    });
    if (!dash) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Dashboard not found" } });
    return dash;
  });

  /**
   * PUBLIC dashboard render (S10) — no session, share-token only. The security shape is the whole lesson: this
   * path executes ONLY SAVED insight definitions attached to this dashboard. It never accepts a request-supplied
   * spec/AST. A public endpoint that runs stored queries is fine; one that runs request-supplied queries is a
   * data-exfiltration API. The boundary is *whose* query runs.
   */
  app.get<{ Params: { token: string } }>("/public/:token", async (req, reply) => {
    const dashboardId = await resolveShareToken(req.params.token);
    if (!dashboardId) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Invalid share link" } });
    const dash = await prisma.dashboard.findUnique({
      where: { id: dashboardId },
      select: { name: true, tiles: { select: { id: true, insightId: true, x: true, y: true, w: true, h: true } } },
    });
    return { name: dash?.name ?? "", tiles: dash?.tiles ?? [] };
  });

  /** A single tile's result on the public path — restricted to insights that belong to THIS dashboard. */
  app.get<{ Params: { token: string; insightId: string } }>("/public/:token/tiles/:insightId", async (req, reply) => {
    const dashboardId = await resolveShareToken(req.params.token);
    if (!dashboardId) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Invalid share link" } });
    // The insight must be a tile on this dashboard — you can't pass an arbitrary insightId to read other data.
    const tile = await prisma.dashboardTile.findFirst({ where: { dashboardId, insightId: req.params.insightId }, select: { id: true } });
    if (!tile) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not a tile on this dashboard" } });
    const insight = await prisma.insight.findUnique({
      where: { id: req.params.insightId },
      select: { defKind: true, definition: true, defVersion: true, projectId: true },
    });
    if (!insight) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Insight not found" } });
    const key = canonicalHash({ id: req.params.insightId, kind: insight.defKind, def: insight.definition, v: insight.defVersion });
    return resultCache.getOrCompute(key, async () => {
      if (insight.defKind === "funnel" && opts.chFunnel) return opts.chFunnel(FunnelSpecSchema.parse(insight.definition), insight.projectId);
      const spec = TrendSpecSchema.parse(insight.definition);
      const runner = opts.readFromClickhouse && opts.chTrend ? opts.chTrend : runTrendPg;
      return runner(spec, insight.projectId);
    });
  });

  /** Create a cohort (S09) — one AST for property or behavioral. */
  app.post<{ Body: unknown }>("/cohorts", async (req, reply) => {
    const body = CohortBody.parse(req.body);
    const row = await createCohort(body.projectId, body.name, body.definition);
    return reply.code(201).send({ id: row.id, kind: body.definition.kind });
  });

  /** List cohorts with their staleness (membersComputedAt) for the analyst UI. */
  app.get<{ Querystring: { projectId?: string } }>("/cohorts", async (req) => {
    return listCohorts(req.query.projectId ?? "demo-project");
  });

  /** Save an insight — the query DEFINITION, versioned, not its results. */
  app.post<{ Body: unknown }>("/insights", async (req, reply) => {
    const body = SaveInsightBody.parse(req.body);
    const row = await prisma.insight.create({
      data: { projectId: body.projectId, name: body.name, definition: body.definition as object },
      select: { id: true },
    });
    return reply.code(201).send({ id: row.id });
  });

  /** List saved insights for a project. */
  app.get<{ Querystring: { projectId?: string } }>("/insights", async (req) => {
    const projectId = req.query.projectId ?? "demo-project";
    return prisma.insight.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, defVersion: true, definition: true, updatedAt: true },
    });
  });

  /** Resolve a distinctId to its person (S06) — the entry point for the profile UI. */
  app.get<{ Querystring: { projectId?: string; distinctId?: string } }>("/persons/resolve", async (req, reply) => {
    const projectId = req.query.projectId ?? "demo-project";
    const distinctId = req.query.distinctId ?? "";
    const mapping = await prisma.distinctIdMapping.findUnique({
      where: { projectId_distinctId: { projectId, distinctId } },
      select: { personId: true },
    });
    if (!mapping) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "No person for that id" } });
    return { personId: mapping.personId };
  });

  /** A person profile (S06): properties + the full list of distinctIds that merged into them. */
  app.get<{ Params: { personId: string } }>("/persons/:personId", async (req, reply) => {
    const person = await prisma.person.findUnique({
      where: { id: req.params.personId },
      select: { id: true, properties: true, createdAt: true, mappings: { select: { distinctId: true } } },
    });
    if (!person) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Person not found" } });
    return {
      id: person.id,
      properties: person.properties,
      createdAt: person.createdAt,
      distinctIds: person.mappings.map((m) => m.distinctId),
    };
  });

  /** A person's event timeline (S06): their recent events, newest first, resolved through personId. */
  app.get<{ Params: { personId: string } }>("/persons/:personId/events", async (req) => {
    type Row = { id: string; name: string; ts: string };
    return prisma.$queryRaw<Row[]>`
      SELECT "id", "name", to_char("ts", 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts
      FROM "Event" WHERE "personId" = ${req.params.personId}
      ORDER BY "ts" DESC LIMIT 100`;
  });

  // The S05 raw-table live poll (GET /events/live) was DELETED in S11 (flaw #4 harvest): it scanned the events
  // table on every 5s poll, ordered by an unindexed column, for every viewer. Replaced by the SSE tail above,
  // which streams from a dedicated fan-out consumer group and never touches the events store.

  /** "Online now" (S11): distinct visitors in the last few minutes, from the Redis sliding window. */
  app.get<{ Querystring: { projectId?: string } }>("/online", async (req, reply) => {
    if (!opts.onlineWindow) return reply.code(503).send({ error: { code: "UNCONFIGURED", message: "Online window not wired" } });
    return { online: await opts.onlineWindow.count(req.query.projectId ?? "demo-project") };
  });

  /**
   * Daily event counts for the last 30 days — one GROUP BY over the naive events table. This is the query S07
   * will time at scale: fine at thousands of rows, a full-table scan pain at hundreds of millions. ADR-0002's
   * exit criteria are about exactly this shape of query.
   */
  app.get<{ Querystring: { projectId?: string } }>("/insights/daily-counts", async (req) => {
    const projectId = req.query.projectId ?? "demo-project";
    type Row = { day: string; count: bigint };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT to_char(date_trunc('day', "ts"), 'YYYY-MM-DD') AS day, count(*) AS count
      FROM "Event"
      WHERE "projectId" = ${projectId} AND "ts" >= now() - interval '30 days'
      GROUP BY 1
      ORDER BY 1`;
    const daily: DailyCount[] = rows.map((r: Row) => ({ day: r.day, count: Number(r.count) }));
    return daily;
  });

  return app;
}

export { env };
