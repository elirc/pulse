import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { z, ZodError } from "zod";
import { prisma, PrismaKeyStore } from "@pulse/db";
import { CachedKeyResolver, keyCan } from "@pulse/auth";
import { TrendSpecSchema, compileTrendSql, foldTopNRows, type FlatRow } from "@pulse/insights";
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

export interface ApiServerOptions {
  /** Injectable so CI resolves keys against an in-memory store; production defaults to Prisma. */
  resolver?: CachedKeyResolver;
  /** Ingestion pipeline metrics source; wired to Redis in production, an in-memory fake in tests. */
  ingestOps?: IngestOps;
}

const IssueKeyBody = z.object({
  type: z.enum(["WRITE", "SECRET"]),
  label: z.string().max(100).default(""),
});

const TrendBody = z.object({
  projectId: z.string().min(1).default("demo-project"),
  spec: TrendSpecSchema,
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
  app.post<{ Body: unknown }>("/insights/trend", async (req) => {
    const body = TrendBody.parse(req.body);
    const { text, params } = compileTrendSql(body.spec, body.projectId);
    const rows = await prisma.$queryRawUnsafe<TrendRow[]>(text, ...params);
    const flat: FlatRow[] = rows.map((r) => ({ bucket: r.bucket, label: r.label ?? null, value: Number(r.value) }));
    // Breakdowns fold the long tail into "Other" so a high-cardinality property can't return thousands of series.
    return body.spec.breakdown ? foldTopNRows(flat, body.spec.topN) : flat;
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
