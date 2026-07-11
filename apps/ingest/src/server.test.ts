import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { InMemoryEventStream } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { buildIngestServer } from "./server";

// Resolver + stream are both in-memory — no key DB, no Redis. This is how CI exercises the enqueue-only hot
// path: validation and auth run for real; the "storage" is a stream fake we can inspect.
const store = new InMemoryKeyStore();
const writeKey = generateApiKey("WRITE");
store.add(writeKey.hash, { id: "k1", projectId: "proj1", type: "WRITE", revokedAt: null });
const resolver = new CachedKeyResolver(store, { rng: () => 1 });
const stream = new InMemoryEventStream<QueuedEvent>();

const app = buildIngestServer({ resolver, stream });
const authed = { authorization: `Bearer ${writeKey.plaintext}` };

afterAll(async () => {
  await app.close();
});

describe("ingest server — enqueue-only (S04)", () => {
  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rejects an event with no write key (401) before validation", async () => {
    const res = await app.inject({ method: "POST", url: "/e", payload: { name: "$pageview", distinctId: "u1" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unknown write key (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/e",
      headers: { authorization: "Bearer pw_live_unknown" },
      payload: { name: "$pageview", distinctId: "u1" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid event (400)", async () => {
    const res = await app.inject({ method: "POST", url: "/e", headers: authed, payload: { distinctId: "u1" } });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid event with 202 and enqueues it (accepted, not processed)", async () => {
    const before = await stream.depth();
    const res = await app.inject({
      method: "POST",
      url: "/e",
      headers: authed,
      payload: { name: "$pageview", distinctId: "u1", uuid: "evt-1" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 1 });
    expect(await stream.depth()).toBe(before + 1);
  });
});
