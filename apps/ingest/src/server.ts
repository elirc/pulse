import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { PrismaKeyStore } from "@pulse/db";
import { CachedKeyResolver, originAllowed } from "@pulse/auth";
import { EventInputSchema, eventTime, type QueuedEvent } from "@pulse/shared";
import type { StreamProducer } from "@pulse/stream";
import { env } from "./env";

// The SDK batches events and POSTs a JSON array. Accept one event or a bounded batch.
const MAX_BATCH = 100;
const BatchSchema = z.array(EventInputSchema).min(1).max(MAX_BATCH);

/**
 * The ingest server (S04) — a SEPARATE deployable from the app API (ADR-0001), now **enqueue-only**. The
 * synchronous insert is gone: `POST /e` validates the shape cheaply, `XADD`s to the Redis Stream, and returns
 * **202 Accepted**. That status is the contract change, and the contract change is the architecture change —
 * *accepted, not processed*. Storage, enrichment, and dedupe all move to the consumer (a separate deployable),
 * so the hot path does the least possible work per event (target p95 < 15ms).
 *
 * The stream producer is INJECTABLE so tests (and CI) run against an in-memory stream with zero Redis;
 * production wires a Redis-backed stream in index.ts.
 */
export interface IngestServerOptions {
  resolver?: CachedKeyResolver;
  stream: StreamProducer<QueuedEvent>;
  /** Backpressure watermark: shed with 429 when the stream backlog exceeds this. Default from env. */
  maxDepth?: number;
  /** How often (ms) to re-sample stream depth. Default 1000; tests set 0 to sample every request. */
  depthSampleMs?: number;
}

/** Extract the presented write key: `Authorization: Bearer <key>`, or a `?k=` query param for pixel/no-header
 *  callers. The SDK (S03) uses the header; the query form keeps a bare `<img>`/sendBeacon call possible. */
function presentedKey(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  const q = (req.query as { k?: string } | undefined)?.k;
  return typeof q === "string" && q.length > 0 ? q : null;
}

export function buildIngestServer(opts: IngestServerOptions): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" ? { level: "info" } : false });
  // CORS policy #1 (ingest): any origin. An analytics endpoint WANTS cross-origin traffic — customer sites on
  // every domain post here; that's the product, not a hole. The danger was never CORS, it was what the
  // credential allows (solved by the write/secret capability split). The app API uses the opposite policy
  // (same-origin only, origin: env.WEB_URL) because it serves dashboards to our own web app alone.
  void app.register(cors, { origin: true });

  const resolver = opts.resolver ?? new CachedKeyResolver(new PrismaKeyStore(), { ttlMs: 60_000 });
  const stream = opts.stream;
  const maxDepth = opts.maxDepth ?? env.INGEST_MAX_DEPTH;

  // Backpressure: shed load at the EDGE (the cheapest place to say no) when the consumer falls behind and the
  // stream backlog grows past the watermark. The alternative — accept everything — is an out-of-memory consumer
  // and a stream that never drains. We don't call XLEN per request (that would tax the hot path); we sample the
  // depth at most once a second and reuse it. The SDK treats a 429 as retryable and backs off.
  const depthSampleMs = opts.depthSampleMs ?? 1000;
  let cachedDepth = 0;
  let depthCheckedAt = -Infinity;
  const overWatermark = async (): Promise<boolean> => {
    const now = Date.now();
    if (now - depthCheckedAt >= depthSampleMs) {
      cachedDepth = await stream.depth();
      depthCheckedAt = now;
    }
    return cachedDepth > maxDepth;
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      void reply.code(400).send({ error: { code: "VALIDATION", message: "Invalid event" } });
      return;
    }
    void reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Auth → cheap shape validation → XADD → 202. Enrichment and the insert happen later, in the consumer.
  app.post("/e", async (req, reply) => {
    const key = presentedKey(req);
    if (!key) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Write key required" } });
    }
    const resolved = await resolver.resolve(key);
    if (!resolved) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid write key" } });
    }
    if (!originAllowed(resolved.allowedOrigins, req.headers.origin ?? null)) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Origin not allowed for this key" } });
    }
    if (await overWatermark()) {
      // Shed politely: tell the client when to come back rather than dropping silently.
      return reply
        .code(429)
        .header("retry-after", "2")
        .send({ error: { code: "BACKPRESSURE", message: "Ingest is shedding load; retry shortly" } });
    }

    const inputs = Array.isArray(req.body) ? BatchSchema.parse(req.body) : [EventInputSchema.parse(req.body)];
    const now = new Date().toISOString();
    for (const input of inputs) {
      const queued: QueuedEvent = {
        uuid: input.uuid ?? randomUUID(), // prefer the SDK's client-minted id; mint one if a raw caller omitted it
        projectId: resolved.projectId,
        distinctId: input.distinctId,
        name: input.name,
        props: input.props,
        ts: eventTime(input.ts).toISOString(), // client clock still trusted here (flaw territory, S13)
        ingestedAt: now,
      };
      await stream.add(queued);
    }
    // 202 Accepted — not 200 OK. We have durably queued the event; we have NOT processed it. The SDK must
    // assume nothing about queryability from this response.
    return reply.code(202).send({ accepted: inputs.length });
  });

  return app;
}

export { env };
