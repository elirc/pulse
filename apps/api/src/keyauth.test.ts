import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { buildApiServer } from "./server";

/**
 * The attack (S02 in-PR arc): a WRITE key is PUBLIC — it ships in page source, visible to anyone who hits
 * view-source. If the events read endpoint accepts any valid key, a stranger can read the whole project's
 * event stream with a credential we handed the browser on purpose.
 *
 * This spec fails against the flawed endpoint (which accepts any valid key) and passes once the capability
 * guard lands. It never touches the database: the guard rejects the write key BEFORE any query runs.
 */
const store = new InMemoryKeyStore();
const writeKey = generateApiKey("WRITE");
const secretKey = generateApiKey("SECRET");
store.add(writeKey.hash, { id: "wk", projectId: "p1", type: "WRITE", revokedAt: null });
store.add(secretKey.hash, { id: "sk", projectId: "p1", type: "SECRET", revokedAt: null });
const resolver = new CachedKeyResolver(store, { rng: () => 1 });

const app = buildApiServer({ resolver });
afterAll(async () => {
  await app.close();
});

describe("privilege confusion: a public write key must never read events (S02)", () => {
  it("denies a WRITE key on the events read endpoint (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects/p1/events",
      headers: { authorization: `Bearer ${writeKey.plaintext}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a request with no key (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/projects/p1/events" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a key that belongs to a different project (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects/other/events",
      headers: { authorization: `Bearer ${secretKey.plaintext}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
