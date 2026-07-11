import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { z, ZodError } from "zod";
import { prisma } from "@pulse/db";
import type { DailyCount } from "@pulse/shared";
import { env } from "./env";
import { requireSession } from "./auth";
import { assertProjectInOrg, issueKey, listKeys } from "./keys";

const IssueKeyBody = z.object({
  type: z.enum(["WRITE", "SECRET"]),
  label: z.string().max(100).default(""),
});

/**
 * The app API (S01) — the ANALYST-facing surface, deployed separately from ingest (ADR-0001). Dashboards and
 * insight queries live here; they can be slow and heavy without ever touching the ingest hot path. In S01 the
 * only insight is a daily count — the first, simplest aggregation over the event firehose.
 */
export function buildApiServer(): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" ? { level: "info" } : false });
  void app.register(cors, { origin: env.WEB_URL });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      void reply.code(400).send({ error: { code: "VALIDATION", message: "Invalid request" } });
      return;
    }
    void reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });

  app.get("/health", async () => ({ status: "ok" }));

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
