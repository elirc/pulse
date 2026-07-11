import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { buildIngestServer } from "./server";

// A resolver over an in-memory key store — no database. This is how CI authenticates the hot path: the same
// injection seam production uses for Prisma, wired to a fake here. /health and validation touch no DB; the
// insert path is verified via typecheck + build and exercised only in local/lab load tests.
const store = new InMemoryKeyStore();
const writeKey = generateApiKey("WRITE");
store.add(writeKey.hash, { id: "k1", projectId: "proj1", type: "WRITE", revokedAt: null });
const resolver = new CachedKeyResolver(store, { rng: () => 1 }); // rng:1 → never samples lastUsedAt in tests

const app = buildIngestServer({ resolver });
const authed = { authorization: `Bearer ${writeKey.plaintext}` };

afterAll(async () => {
  await app.close();
});

describe("ingest server (S02)", () => {
  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rejects an event with no write key (401) before validation", async () => {
    const res = await app.inject({ method: "POST", url: "/e", payload: { name: "$pageview", distinctId: "u1" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an event with an unknown write key (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/e",
      headers: { authorization: "Bearer pw_live_unknown" },
      payload: { name: "$pageview", distinctId: "u1" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("with a valid key, rejects an event with no name (400) before touching the DB", async () => {
    const res = await app.inject({ method: "POST", url: "/e", headers: authed, payload: { distinctId: "u1" } });
    expect(res.statusCode).toBe(400);
  });

  it("with a valid key, rejects an event with no distinctId (400)", async () => {
    const res = await app.inject({ method: "POST", url: "/e", headers: authed, payload: { name: "$pageview" } });
    expect(res.statusCode).toBe(400);
  });
});
