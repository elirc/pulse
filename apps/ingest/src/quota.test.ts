import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { InMemoryEventStream } from "@pulse/stream";
import { assessQuota, type QueuedEvent } from "@pulse/shared";
import { buildIngestServer } from "./server";

const store = new InMemoryKeyStore();
const writeKey = generateApiKey("WRITE");
store.add(writeKey.hash, { id: "k1", projectId: "proj1", type: "WRITE", revokedAt: null });
const resolver = new CachedKeyResolver(store, { rng: () => 1 });
const stream = new InMemoryEventStream<QueuedEvent>();
const authed = { authorization: `Bearer ${writeKey.plaintext}` };

// Usage is a mutable ref so a test can push the project over its allowance.
const usage = { used: 0, allowance: 1000 };
const app = buildIngestServer({
  resolver,
  stream,
  quotaCheck: (_pid) => Promise.resolve(assessQuota(usage.used, usage.allowance)),
});

afterAll(async () => {
  await app.close();
});

const post = (): Promise<Awaited<ReturnType<typeof app.inject>>> =>
  Promise.resolve(app.inject({ method: "POST", url: "/e", headers: authed, payload: { name: "$pageview", distinctId: "u1" } }));

describe("ingest per-project quota (S15)", () => {
  it("accepts under the allowance", async () => {
    usage.used = 100;
    expect((await post()).statusCode).toBe(202);
  });

  it("flags soft state via a header when over the soft limit but still accepts", async () => {
    usage.used = 850; // 85% of 1000
    const res = await post();
    expect(res.statusCode).toBe(202);
    expect(res.headers["x-quota-state"]).toBe("soft");
  });

  it("sheds with 429 + Retry-After when the allowance is exhausted (hard limit)", async () => {
    usage.used = 1000;
    const res = await post();
    expect(res.statusCode).toBe(429);
    expect(res.headers["x-quota-state"]).toBe("hard");
    expect(res.json()).toMatchObject({ error: { code: "QUOTA_EXCEEDED" } });
  });
});
