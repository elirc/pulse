import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z, ZodError } from "zod";
import { PrismaKeyStore } from "@pulse/db";
import { CachedKeyResolver, originAllowed } from "@pulse/auth";
import { EventInputSchema, eventTime } from "@pulse/shared";
import { PrismaEventSink, type EventSink } from "./eventsink";
import { env } from "./env";

// The SDK batches events and POSTs a JSON array. Accept one event or a bounded batch. Extra fields the SDK
// sends (e.g. the client-minted `uuid`) are stripped by the schema for now; S04 adds uuid + dedupe.
const MAX_BATCH = 100;
const BatchSchema = z.array(EventInputSchema).min(1).max(MAX_BATCH);

/**
 * The ingest server (S02) — a SEPARATE deployable from the app API (ADR-0001). The hot path has different
 * physics: spiky, latency-sensitive, authenticated by a public WRITE key, and it must never be starved by a
 * heavy dashboard query sharing its process.
 *
 * `POST /e` is still a SYNCHRONOUS insert (the honest baseline the course measures against). What's new in S02
 * is auth: a write key resolves to a projectId. That resolution is the first hot-path cost decision — it is
 * cached in-process (see CachedKeyResolver) so it does not add a DB round-trip per event.
 *
 * The resolver is INJECTABLE so tests (and CI) resolve keys against an in-memory store with zero database;
 * production defaults to the Prisma-backed store.
 */
export interface IngestServerOptions {
  resolver?: CachedKeyResolver;
  sink?: EventSink;
}

/** Extract the presented write key: `Authorization: Bearer <key>`, or a `?k=` query param for pixel/no-header
 *  callers. The SDK (S03) uses the header; the query form keeps a bare `<img>` beacon possible. */
function presentedKey(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  const q = (req.query as { k?: string } | undefined)?.k;
  return typeof q === "string" && q.length > 0 ? q : null;
}

export function buildIngestServer(opts: IngestServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" ? { level: "info" } : false });
  // CORS policy #1 (ingest): any origin. An analytics endpoint WANTS cross-origin traffic — customer sites on
  // every domain post here; that's the product, not a hole. The danger was never CORS, it was what the
  // credential allows (solved by the write/secret capability split). The app API uses the opposite policy
  // (same-origin only, origin: env.WEB_URL) because it serves dashboards to our own web app alone.
  void app.register(cors, { origin: true });

  const resolver = opts.resolver ?? new CachedKeyResolver(new PrismaKeyStore(), { ttlMs: 60_000 });
  const sink = opts.sink ?? new PrismaEventSink();

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      void reply.code(400).send({ error: { code: "VALIDATION", message: "Invalid event" } });
      return;
    }
    void reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Auth → validate → insert → 200. Auth precedes validation so an unauthenticated caller learns nothing
  // about our request shape. projectId now comes from the resolved key (a fixed demo value in S01).
  app.post("/e", async (req, reply) => {
    const key = presentedKey(req);
    if (!key) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Write key required" } });
    }
    const resolved = await resolver.resolve(key);
    if (!resolved) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid write key" } });
    }
    // Optional per-key origin allowlist — abuse reduction for browser traffic, off by default (see origin.ts).
    if (!originAllowed(resolved.allowedOrigins, req.headers.origin ?? null)) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Origin not allowed for this key" } });
    }

    const inputs = Array.isArray(req.body) ? BatchSchema.parse(req.body) : [EventInputSchema.parse(req.body)];
    for (const input of inputs) {
      await sink.append({
        projectId: resolved.projectId,
        distinctId: input.distinctId,
        name: input.name,
        props: input.props,
        ts: eventTime(input.ts), // client clock trusted in S02 (a flaw revisited S04/S13)
      });
    }
    // 200 with a tiny body — the SDK is fire-and-forget.
    return reply.code(200).send({ ok: true, accepted: inputs.length });
  });

  return app;
}

export { env };
