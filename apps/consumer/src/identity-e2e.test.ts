import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { InMemoryEventStream } from "@pulse/stream";
import { buildIngestServer } from "@pulse/ingest/server";
import type { QueuedEvent } from "@pulse/shared";
import { InMemoryEventStore } from "./store";
import { InMemoryDeadLetterQueue } from "./dlq";
import { IdentityResolver } from "./identity";
import { InMemoryPersonStore } from "./personstore";
import { drain } from "./worker";

/**
 * Identity E2E (S06): browse anonymous → sign in (identify) → the person's timeline shows BOTH phases stitched
 * to one person. The whole point of identity resolution, proven end-to-end through the real ingest + consumer.
 */
function evt(name: string, distinctId: string, props: Record<string, unknown> = {}): Record<string, unknown> {
  return { uuid: randomUUID(), name, distinctId, props, ts: new Date().toISOString() };
}

const keyStore = new InMemoryKeyStore();
const wk = generateApiKey("WRITE");
keyStore.add(wk.hash, { id: "k1", projectId: "acme", type: "WRITE", revokedAt: null });
const stream = new InMemoryEventStream<QueuedEvent>();
const ingest = buildIngestServer({ resolver: new CachedKeyResolver(keyStore, { rng: () => 1 }), stream });

afterAll(async () => {
  await ingest.close();
});

describe("identity E2E: anonymous → identify → unified timeline (S06)", () => {
  it("stitches the anonymous and identified phases into one person", async () => {
    // Anonymous browsing, then sign-in ($identify carries the anon id), then activity as the user.
    const batch = [
      evt("$pageview", "anon-1"),
      evt("signup_started", "anon-1"),
      evt("$identify", "user-42", { $anon_distinct_id: "anon-1" }),
      evt("$pageview", "user-42"),
      evt("purchase", "user-42"),
    ];
    const res = await ingest.inject({
      method: "POST",
      url: "/e",
      headers: { authorization: `Bearer ${wk.plaintext}` },
      payload: batch,
    });
    expect(res.statusCode).toBe(202);

    const eventStore = new InMemoryEventStore();
    const personStore = new InMemoryPersonStore();
    await drain({
      stream,
      store: eventStore,
      dlq: new InMemoryDeadLetterQueue(),
      resolver: new IdentityResolver(personStore, { ttlMs: 0 }),
      group: "inserters",
      batchSize: 100,
    });

    // All five events resolve to ONE person, across both the anon and the user distinctIds.
    const personIds = new Set(eventStore.events.map((e) => e.personId));
    expect(personIds.size).toBe(1);
    const [personId] = [...personIds];

    const timelineNames = eventStore.events.filter((e) => e.personId === personId).map((e) => e.name);
    expect(timelineNames).toContain("signup_started"); // anonymous phase
    expect(timelineNames).toContain("purchase"); // identified phase
    // Events keep their ORIGINAL distinctId (immutable log) — the stitching is via personId, not rewriting.
    const distinctIds = new Set(eventStore.events.map((e) => e.distinctId));
    expect(distinctIds).toEqual(new Set(["anon-1", "user-42"]));
  });
});
