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
  UNIQ_RELATIVE_ERROR,
  type FlatRow,
  type TrendSpec,
  type FunnelSpec,
  type FunnelResult,
} from "@pulse/insights";
import type { DailyCount } from "@pulse/shared";
import { env } from "./env";
import { requireSession } from "./auth";
import { resolveKey } from "./keyauth";
import { assertProjectInOrg, issueKey, listKeys } from "./keys";

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
  /** ClickHouse trend backend (S07). When present + readFromClickhouse, trends read CH; verify runs both. */
  chTrend?: TrendRunner;
  /** ClickHouse funnel backend (S08). Funnels run as windowFunnel() queries. */
  chFunnel?: FunnelRunner;
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

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      void reply.code(400).send({ error: { code: "VALIDATION", message: "Invalid request" } });
      return;
    }
    void reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });

  app.get("/health", async () => ({ status: "ok" }));

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

  app.post<{ Body: unknown }>("/insights/trend", async (req) => {
    const body = TrendBody.parse(req.body);
    // Read cutover (S07): serve from ClickHouse once the flag flips; Postgres until then.
    const runner = opts.readFromClickhouse && opts.chTrend ? opts.chTrend : runTrendPg;
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

  /** Funnel query (S08): ordered-step conversion via ClickHouse windowFunnel(). */
  app.post<{ Body: unknown }>("/insights/funnel", async (req, reply) => {
    const body = z.object({ projectId: z.string().min(1).default("demo-project"), spec: FunnelSpecSchema }).parse(req.body);
    if (!opts.chFunnel) {
      return reply.code(503).send({ error: { code: "UNCONFIGURED", message: "ClickHouse funnel backend not wired" } });
    }
    return opts.chFunnel(body.spec, body.projectId);
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

  /**
   * Live events feed (S05): the latest 100 events for a project, newest first, for the "is it working?" view.
   * Ordered by server receive time so events show up in arrival order.
   */
  app.get<{ Querystring: { projectId?: string } }>("/events/live", async (req) => {
    const projectId = req.query.projectId ?? "demo-project";
    type LiveRow = { id: string; name: string; distinctId: string; ts: string };
    const rows = await prisma.$queryRaw<LiveRow[]>`
      SELECT "id", "name", "distinctId", to_char("ts", 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts
      FROM "Event"
      WHERE "projectId" = ${projectId}
      ORDER BY "ingestedAt" DESC
      LIMIT 100`;
    return rows;
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
