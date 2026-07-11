import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { buildIngestServer } from "./server";
import { InMemoryEventSink } from "./eventsink";

// The SDK POSTs a JSON array (a batch). Ingest accepts one event or a bounded batch; assert both, DB-free.
const store = new InMemoryKeyStore();
const wk = generateApiKey("WRITE");
store.add(wk.hash, { id: "k1", projectId: "p1", type: "WRITE", revokedAt: null });
const sink = new InMemoryEventSink();
const app = buildIngestServer({ resolver: new CachedKeyResolver(store, { rng: () => 1 }), sink });
const authed = { authorization: `Bearer ${wk.plaintext}` };

afterAll(async () => {
  await app.close();
});

describe("ingest batch acceptance (S03)", () => {
  it("accepts a batch array and appends every event", async () => {
    const batch = [
      { name: "$pageview", distinctId: "u1" },
      { name: "signup_started", distinctId: "u1" },
      { name: "purchase", distinctId: "u2" },
    ];
    const res = await app.inject({ method: "POST", url: "/e", headers: authed, payload: batch });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, accepted: 3 });
    expect(sink.events).toHaveLength(3);
  });

  it("still accepts a single event object", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/e",
      headers: authed,
      payload: { name: "$pageview", distinctId: "u3" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, accepted: 1 });
  });

  it("rejects an over-large batch (400)", async () => {
    const huge = Array.from({ length: 101 }, () => ({ name: "x", distinctId: "u" }));
    const res = await app.inject({ method: "POST", url: "/e", headers: authed, payload: huge });
    expect(res.statusCode).toBe(400);
  });
});
