import { describe, it, expect } from "vitest";
import { computeTrend, bucketKey, unitOf, type EventLike } from "./compute";
import { isRollupEligible } from "./rollup";
import { TrendSpecSchema, type TrendSpec } from "./spec";

/**
 * Rollup parity golden (S12). The rollup (events_daily) pre-aggregates per (project, event, day) with
 * sumState(count) + uniqState(person). The whole bet is that reading the rollup returns the SAME answer as
 * scanning raw events — otherwise the "70% of load served from a tiny table" optimization silently corrupts
 * numbers. This is the eval that proves it: build the rollup in-memory from a fixture, read it back, and assert
 * it equals the raw interpreter (the S05 golden oracle) for every rollup-eligible spec.
 *
 * The simulation uses an EXACT Set for uniques (not HLL), so parity here is exact — it validates the AGGREGATION
 * SEMANTICS (group-by-day, sum counts, union persons). The separate ~0.5% uniq() HLL error bound is covered by
 * golden-parity.test.ts; conflating the two would hide a real semantic bug behind an approximation tolerance.
 */
const D = (iso: string): Date => new Date(iso);
const now = (): Date => new Date("2026-07-12T00:00:00Z");

const EVENTS: EventLike[] = [
  { name: "$pageview", distinctId: "alice", ts: D("2026-07-10T08:00:00Z"), props: {} },
  { name: "$pageview", distinctId: "alice", ts: D("2026-07-10T09:00:00Z"), props: {} },
  { name: "$pageview", distinctId: "bob", ts: D("2026-07-10T10:00:00Z"), props: {} },
  { name: "$pageview", distinctId: "carol", ts: D("2026-07-11T09:00:00Z"), props: {} },
  { name: "$pageview", distinctId: "carol", ts: D("2026-07-11T18:00:00Z"), props: {} },
  { name: "purchase", distinctId: "alice", ts: D("2026-07-10T11:00:00Z"), props: {} },
  { name: "purchase", distinctId: "bob", ts: D("2026-07-11T10:00:00Z"), props: {} },
];

/** Build the daily rollup exactly as events_daily would: per (event, day) → count + distinct persons. */
function buildRollup(events: EventLike[]): Map<string, Map<string, { count: number; persons: Set<string> }>> {
  const roll = new Map<string, Map<string, { count: number; persons: Set<string> }>>();
  for (const e of events) {
    const day = bucketKey(e.ts, "day");
    let byDay = roll.get(e.name);
    if (!byDay) roll.set(e.name, (byDay = new Map()));
    let cell = byDay.get(day);
    if (!cell) byDay.set(day, (cell = { count: 0, persons: new Set() }));
    cell.count += 1;
    cell.persons.add(unitOf(e));
  }
  return roll;
}

/** Read the rollup for an eligible spec — the equivalent of the compileTrendRollup query. */
function readRollup(
  roll: ReturnType<typeof buildRollup>,
  spec: TrendSpec,
): { buckets: string[]; values: number[] } {
  const byDay = roll.get(spec.event!) ?? new Map();
  const buckets = [...byDay.keys()].sort();
  const values = buckets.map((b) => {
    const cell = byDay.get(b)!;
    return spec.metric === "unique" ? cell.persons.size : cell.count;
  });
  return { buckets, values };
}

describe("rollup parity — reading the rollup == scanning raw events (S12)", () => {
  const roll = buildRollup(EVENTS);
  const cases: TrendSpec[] = [
    TrendSpecSchema.parse({ event: "$pageview", metric: "total", interval: "day" }),
    TrendSpecSchema.parse({ event: "$pageview", metric: "unique", interval: "day" }),
    TrendSpecSchema.parse({ event: "purchase", metric: "total", interval: "day" }),
    TrendSpecSchema.parse({ event: "purchase", metric: "unique", interval: "day" }),
  ];

  for (const spec of cases) {
    it(`${spec.event} ${spec.metric}: rollup matches the raw interpreter`, () => {
      expect(isRollupEligible(spec)).toBe(true); // guard: only eligible specs may use the rollup
      const raw = computeTrend(EVENTS, spec, now);
      const fromRollup = readRollup(roll, spec);
      expect(fromRollup.buckets).toEqual(raw.buckets);
      expect(fromRollup.values).toEqual(raw.series[0].values);
    });
  }

  it("carol counted once/day for uniques but twice for totals (the classic rollup trap, handled)", () => {
    const uniq = readRollup(roll, cases[1]);
    const total = readRollup(roll, cases[0]);
    // 2026-07-11: carol fired 2 pageviews → total 2, unique 1.
    const i = uniq.buckets.indexOf("2026-07-11");
    expect(total.values[i]).toBe(2);
    expect(uniq.values[i]).toBe(1);
  });
});
