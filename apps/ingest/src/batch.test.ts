import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { InMemoryEventStream } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { buildIngestServer } from "./server";

// The SDK POSTs a JSON array (a batch). Ingest accepts one event or a bounded batch and XADDs each, DB/Redis-free.
const store = new InMemoryKeyStore();
const wk = generateApiKey("WRITE");
store.add(wk.hash, { id: "k1", projectId: "p1", type: "WRITE", revokedAt: null });
const stream = new InMemoryEventStream<QueuedEvent>();
const app = buildIngestServer({ resolver: new CachedKeyResolver(store, { rng: () => 1 }), stream });
const authed = { authorization: `Bearer ${wk.plaintext}` };

afterAll(async () => {
  await app.close();
});

describe("ingest batch acceptance (S04)", () => {
  it("accepts a batch array, enqueues every event, returns 202", async () => {
    const before = await stream.depth();
    const batch = [
      { name: "$pageview", distinctId: "u1" },
      { name: "signup_started", distinctId: "u1" },
      { name: "purchase", distinctId: "u2" },
    ];
    const res = await app.inject({ method: "POST", url: "/e", headers: authed, payload: batch });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: 3 });
    expect(await stream.depth()).toBe(before + 3);
  });

  it("still accepts a single event object (202)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/e",
      headers: authed,
      payload: { name: "$pageview", distinctId: "u3" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: 1 });
  });

  it("rejects an over-large batch (400)", async () => {
    const huge = Array.from({ length: 101 }, () => ({ name: "x", distinctId: "u" }));
    const res = await app.inject({ method: "POST", url: "/e", headers: authed, payload: huge });
    expect(res.statusCode).toBe(400);
  });
});
