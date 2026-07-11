import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { prisma } from "@pulse/db";
import { EventInputSchema, eventTime } from "@pulse/shared";
import { env } from "./env";

/**
 * The ingest server (S01) — a SEPARATE deployable from the app API (ADR-0001). The hot path has different
 * physics: spiky, latency-sensitive, authenticated by a public write key (S02), and it must never be starved by
 * a heavy dashboard query sharing its process. So it lives on its own from day one.
 *
 * `POST /e` here is a SYNCHRONOUS insert — deliberately naive. It is correct, and it is the honest baseline the
 * whole course measures against: no queue, no batching, no dedupe. Those arrive when the numbers demand them
 * (queue S04, batching/dedupe S04, columnar store S07). ADR-0002 wrote down the line; S07 measures us across it.
 */
export function buildIngestServer(): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" ? { level: "info" } : false });
  void app.register(cors, { origin: true }); // the SDK posts from arbitrary customer origins

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      void reply.code(400).send({ error: { code: "VALIDATION", message: "Invalid event" } });
      return;
    }
    void reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });

  app.get("/health", async () => ({ status: "ok" }));

  // The whole ingest surface for now. Validate → resolve project (fixed in S01) → insert → 200.
  app.post("/e", async (req, reply) => {
    const input = EventInputSchema.parse(req.body);
    await prisma.event.create({
      data: {
        projectId: "demo-project", // real write-key → projectId resolution is S02
        distinctId: input.distinctId,
        name: input.name,
        props: input.props as object,
        ts: eventTime(input.ts), // client clock trusted in S01 (a flaw revisited S04/S13)
      },
    });
    // 200 with an empty body — the SDK is fire-and-forget; keep the response tiny.
    return reply.code(200).send({ ok: true });
  });

  return app;
}

export { env };
