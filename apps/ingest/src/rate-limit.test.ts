import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { InMemoryEventStream } from "@pulse/stream";
import { KeyedRateLimiter, type QueuedEvent } from "@pulse/shared";
import { buildIngestServer } from "./server";

const store = new InMemoryKeyStore();
const writeKey = generateApiKey("WRITE");
store.add(writeKey.hash, { id: "k1", projectId: "proj1", type: "WRITE", revokedAt: null });
const resolver = new CachedKeyResolver(store, { rng: () => 1 });
const stream = new InMemoryEventStream<QueuedEvent>();
const authed = { authorization: `Bearer ${writeKey.plaintext}` };

// Frozen clock so no refill happens mid-test; capacity 3 events.
const rateLimiter = new KeyedRateLimiter({ capacity: 3, refillPerSec: 1, now: () => 0 });
const app = buildIngestServer({ resolver, stream, rateLimiter });

afterAll(async () => {
  await app.close();
});

describe("ingest per-key rate limiting (S13)", () => {
  it("allows a burst up to capacity then 429s with Retry-After, and records the abuse", async () => {
    const post = (): Promise<Awaited<ReturnType<typeof app.inject>>> =>
      Promise.resolve(app.inject({ method: "POST", url: "/e", headers: authed, payload: { name: "$pageview", distinctId: "u1" } }));

    expect((await post()).statusCode).toBe(202);
    expect((await post()).statusCode).toBe(202);
    expect((await post()).statusCode).toBe(202); // capacity = 3
    const limited = await post();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

    const abuse = await app.inject({ method: "GET", url: "/ops/abuse" });
    const keys = (abuse.json() as { keys: Array<{ key: string; rejected: number }> }).keys;
    expect(keys[0].key).toBe("proj1");
    expect(keys[0].rejected).toBeGreaterThanOrEqual(1);
  });

  it("charges cost = batch size (a 3-event batch consumes the whole bucket at once)", async () => {
    // A fresh limiter/app so the bucket starts full.
    const rl = new KeyedRateLimiter({ capacity: 3, refillPerSec: 1, now: () => 0 });
    const app2 = buildIngestServer({ resolver, stream, rateLimiter: rl });
    const batch = [
      { name: "a", distinctId: "u1" },
      { name: "b", distinctId: "u1" },
      { name: "c", distinctId: "u1" },
    ];
    expect((await app2.inject({ method: "POST", url: "/e", headers: authed, payload: batch })).statusCode).toBe(202);
    // Bucket now empty → even a single event is rejected.
    const one = await app2.inject({ method: "POST", url: "/e", headers: authed, payload: { name: "d", distinctId: "u1" } });
    expect(one.statusCode).toBe(429);
    await app2.close();
  });
});
