import { describe, it, expect, afterAll } from "vitest";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey, keyCan } from "@pulse/auth";
import { aggregateDailyCounts } from "@pulse/shared";
import { buildIngestServer } from "./server";
import { InMemoryEventSink } from "./eventsink";

/**
 * End-to-end (S02), DB-free: create project → issue a write key → "curl" an event with it → it lands tagged
 * with the resolved project → it shows up in daily counts. The whole walking skeleton, minus Postgres, wired
 * through the same injection seams production uses. The real-Postgres version of this is a local/lab run.
 */
const PROJECT = "proj-acme";
const store = new InMemoryKeyStore();
const writeKey = generateApiKey("WRITE");
const secretKey = generateApiKey("SECRET");
store.add(writeKey.hash, { id: "wk", projectId: PROJECT, type: "WRITE", revokedAt: null });
store.add(secretKey.hash, { id: "sk", projectId: PROJECT, type: "SECRET", revokedAt: null });

const resolver = new CachedKeyResolver(store, { rng: () => 1 });
const sink = new InMemoryEventSink();
const app = buildIngestServer({ resolver, sink });

afterAll(async () => {
  await app.close();
});

describe("e2e: project → snippet → event → daily counts (S02)", () => {
  it("ingests an event with the write key and tags it with the resolved project", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/e",
      headers: { authorization: `Bearer ${writeKey.plaintext}` },
      payload: { name: "$pageview", distinctId: "visitor-1", ts: "2026-07-11T09:00:00Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({ projectId: PROJECT, name: "$pageview", distinctId: "visitor-1" });
  });

  it("the ingested event appears in daily counts", async () => {
    await app.inject({
      method: "POST",
      url: "/e",
      headers: { authorization: `Bearer ${writeKey.plaintext}` },
      payload: { name: "signup_started", distinctId: "visitor-2", ts: "2026-07-11T18:00:00Z" },
    });
    const daily = aggregateDailyCounts(sink.events);
    expect(daily).toContainEqual({ day: "2026-07-11", count: 2 });
  });

  it("only the secret key could read those events back — the public write key cannot", () => {
    expect(keyCan(writeKey.type, "read")).toBe(false);
    expect(keyCan(secretKey.type, "read")).toBe(true);
  });
});
