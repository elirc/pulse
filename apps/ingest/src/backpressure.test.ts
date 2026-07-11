import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { InMemoryEventStream } from "@pulse/stream";
import type { QueuedEvent } from "@pulse/shared";
import { buildIngestServer } from "./server";

const store = new InMemoryKeyStore();
const wk = generateApiKey("WRITE");
store.add(wk.hash, { id: "k1", projectId: "p1", type: "WRITE", revokedAt: null });
const resolver = new CachedKeyResolver(store, { rng: () => 1 });
const stream = new InMemoryEventStream<QueuedEvent>();

// A tiny watermark so a couple of backlogged entries trip it; depthSampleMs:0 samples depth every request.
const app = buildIngestServer({ resolver, stream, maxDepth: 3, depthSampleMs: 0 });
const authed = { authorization: `Bearer ${wk.plaintext}` };

afterAll(async () => {
  await app.close();
});

describe("ingest backpressure (S04)", () => {
  it("accepts while under the watermark", async () => {
    const res = await app.inject({ method: "POST", url: "/e", headers: authed, payload: { name: "e", distinctId: "u" } });
    expect(res.statusCode).toBe(202);
  });

  it("sheds with 429 + Retry-After once the backlog exceeds the watermark", async () => {
    for (let i = 0; i < 5; i++) await stream.add({} as QueuedEvent); // push backlog past maxDepth=3
    const res = await app.inject({ method: "POST", url: "/e", headers: authed, payload: { name: "e", distinctId: "u" } });
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("2");
  });
});
