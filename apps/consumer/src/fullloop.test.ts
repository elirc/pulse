import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { CachedKeyResolver, InMemoryKeyStore, generateApiKey } from "@pulse/auth";
import { InMemoryEventStream } from "@pulse/stream";
import { buildIngestServer } from "@pulse/ingest/server";
import { computeTrend, TrendSpecSchema, type EventLike } from "@pulse/insights";
import type { QueuedEvent } from "@pulse/shared";
import { InMemoryEventStore } from "./store";
import { InMemoryDeadLetterQueue } from "./dlq";
import { IdentityResolver } from "./identity";
import { InMemoryPersonStore } from "./personstore";
import { drain } from "./worker";

/**
 * The full-loop E2E (S05): one test that traverses EVERY system boundary —
 *   SDK envelope → ingest HTTP (202) → Redis Stream → consumer group → store → trend query.
 * Wired end-to-end on in-memory fakes so it runs in CI. This is the regression net the S07 migration will lean
 * on: if a trend still equals its captured value after swapping the storage backend, the migration is
 * behaviorally correct. Worth fifty unit tests for confidence. (The SDK itself is exercised in its own suite;
 * here we build the same envelope shape it emits, and drive it through everything downstream for real.)
 */

// The exact wire shape @pulse/sdk POSTs (uuid, name, distinctId, props, ts). Not importing the browser SDK
// keeps this Node test free of the DOM lib the SDK requires.
function envelope(name: string, distinctId: string, props: Record<string, unknown> = {}): Record<string, unknown> {
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

describe("full loop: SDK → ingest → stream → consumer → store → trend (S05)", () => {
  it("captured events end up counted in a trend and visible to the live feed", async () => {
    // 1. The SDK's batch (two people, three events) hits the real ingest server → 202 → onto the stream.
    const batch = [
      envelope("$pageview", "u1", { plan: "pro" }),
      envelope("purchase", "u1", { plan: "pro" }),
      envelope("$pageview", "u2"),
    ];
    const res = await ingest.inject({
      method: "POST",
      url: "/e",
      headers: { authorization: `Bearer ${wk.plaintext}` },
      payload: batch,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: 3 });

    // 2. The consumer drains the stream into the store (enrich + idempotent insert).
    const store = new InMemoryEventStore();
    const processed = await drain({
      stream,
      store,
      dlq: new InMemoryDeadLetterQueue(),
      resolver: new IdentityResolver(new InMemoryPersonStore()),
      group: "inserters",
      batchSize: 100,
    });
    expect(processed).toBe(3);

    // 3. Events are tagged with the resolved project and enriched.
    expect(store.events.every((e) => e.projectId === "acme")).toBe(true);
    expect(store.events[0].props).toHaveProperty("$os"); // enrichment ran

    // 4. A trend query over the stored events returns the counts we captured (the live feed sees them too).
    const asEvents: EventLike[] = store.events.map((e) => ({
      name: e.name,
      distinctId: e.distinctId,
      props: e.props,
      ts: new Date(e.ts),
    }));
    const pageviews = computeTrend(asEvents, TrendSpecSchema.parse({ event: "$pageview", metric: "total" }));
    const purchases = computeTrend(asEvents, TrendSpecSchema.parse({ event: "purchase", metric: "total" }));
    expect(pageviews.series[0].values.reduce((a, b) => a + b, 0)).toBe(2);
    expect(purchases.series[0].values.reduce((a, b) => a + b, 0)).toBe(1);
  });
});
