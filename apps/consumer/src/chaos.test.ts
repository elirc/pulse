import { describe, it, expect } from "vitest";
import { resolveEventTime, MAX_CLOCK_SKEW_MS, type EventInput, type QueuedEvent } from "@pulse/shared";
import { InMemoryEventStore, type StorableEvent } from "./store";

/**
 * Pipeline chaos suite (S13) — a PERMANENT CI adversary for the ingest→consumer path. The S04 idempotency
 * discipline and the S13 timestamp policy are the pipeline's crown invariants; every course fuzzes its own crown
 * invariant (Tracer fuzzed CRDT convergence). Here we generate deliberately hostile input — duplicated,
 * reordered, and clock-skewed events — and assert the invariants hold no matter the disorder:
 *
 *   1. IDEMPOTENCY: stored row count == number of distinct uuids, however many times each is (re)delivered.
 *   2. TIME TRUST: every stored ts is within ±48h of its server ingest time; out-of-window events are flagged.
 *   3. ORDER INDEPENDENCE: the stored set is identical regardless of delivery order.
 *
 * Seeded PRNG so a failure is reproducible from the seed printed in the test name.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const INGEST_ANCHOR = Date.parse("2026-07-11T12:00:00Z");

/** The ingest step: apply the server timestamp policy and build the QueuedEvent the stream carries. */
function ingest(input: EventInput, ingestedAtMs: number): QueuedEvent {
  const ingestedAt = new Date(ingestedAtMs);
  const rt = resolveEventTime(input.ts, ingestedAt);
  const props = rt.clamped ? { ...input.props, $ts_clamped: true } : input.props;
  return {
    uuid: input.uuid!,
    projectId: "demo",
    distinctId: input.distinctId,
    name: input.name,
    props,
    ts: rt.ts.toISOString(),
    ingestedAt: ingestedAt.toISOString(),
  };
}

/** Generate a hostile batch: N unique events, then duplicates and clock-skewed outliers mixed in and shuffled. */
function chaoticBatch(seed: number, n: number): { queued: QueuedEvent[]; distinct: number } {
  const rnd = lcg(seed);
  const base: EventInput[] = [];
  for (let i = 0; i < n; i++) {
    // 1 in 6 events carries a pathological clock: far future, far past, or garbage.
    const roll = Math.floor(rnd() * 6);
    let ts: string | number | undefined;
    if (roll === 0) ts = "2031-01-01T00:00:00Z";
    else if (roll === 1) ts = 0; // 1970
    else if (roll === 2) ts = "not-a-date";
    else ts = new Date(INGEST_ANCHOR - Math.floor(rnd() * 3_600_000)).toISOString(); // within the hour
    base.push({ name: "$pageview", distinctId: `u${i % 7}`, props: {}, ts, uuid: `evt-${i}` });
  }
  const distinct = base.length;
  // At-least-once delivery: some events are redelivered 1–3 extra times (same uuid).
  const withDupes: EventInput[] = [];
  for (const e of base) {
    const copies = 1 + Math.floor(rnd() * 3) * (rnd() < 0.4 ? 1 : 0);
    for (let c = 0; c < copies; c++) withDupes.push(e);
  }
  // Reorder everything.
  for (let i = withDupes.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [withDupes[i], withDupes[j]] = [withDupes[j], withDupes[i]];
  }
  // Each event ingested at a slightly different server time (still all near the anchor).
  const queued = withDupes.map((e) => ingest(e, INGEST_ANCHOR + Math.floor(rnd() * 1000)));
  return { queued, distinct };
}

describe("pipeline chaos suite (S13) — dup / reorder / skew", () => {
  for (const seed of [1, 42, 1337, 99999]) {
    it(`seed ${seed}: idempotency + time-trust hold under hostile input`, async () => {
      const { queued, distinct } = chaoticBatch(seed, 200);
      const store = new InMemoryEventStore();
      // Deliver in randomly-sized sub-batches to mimic redelivery boundaries.
      const rnd = lcg(seed ^ 0x5f3759df);
      for (let i = 0; i < queued.length; ) {
        const size = 1 + Math.floor(rnd() * 20);
        await store.insertBatch(queued.slice(i, i + size) as StorableEvent[]);
        i += size;
      }

      // (1) Idempotency: exactly one stored row per distinct uuid, no matter the duplication/order.
      expect(store.events.length).toBe(distinct);
      expect(new Set(store.events.map((e) => e.uuid)).size).toBe(distinct);

      // (2) Time trust: every stored ts sits within ±48h of its ingest time; out-of-window ones are flagged.
      for (const e of store.events) {
        const skew = Math.abs(Date.parse(e.ts) - Date.parse(e.ingestedAt));
        expect(skew).toBeLessThanOrEqual(MAX_CLOCK_SKEW_MS);
        if (skew === MAX_CLOCK_SKEW_MS) expect(e.props.$ts_clamped).toBe(true);
      }
    });
  }

  it("order independence: shuffling the same events yields the same stored set", async () => {
    const a = chaoticBatch(7, 100);
    const b = chaoticBatch(7, 100); // same seed → same events, generated identically
    const storeA = new InMemoryEventStore();
    const storeB = new InMemoryEventStore();
    await storeA.insertBatch(a.queued as StorableEvent[]);
    // Reverse delivery order for B.
    await storeB.insertBatch([...b.queued].reverse() as StorableEvent[]);
    expect(new Set(storeA.events.map((e) => e.uuid))).toEqual(new Set(storeB.events.map((e) => e.uuid)));
  });
});
