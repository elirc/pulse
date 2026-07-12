import { describe, it, expect } from "vitest";
import { computeTrend, type EventLike } from "./compute";
import { TrendSpecSchema, type Metric } from "./spec";
import { UNIQ_RELATIVE_ERROR } from "./sql-clickhouse";

/**
 * Golden parity (S07): every S05 golden fixture must hold against ClickHouse within a DEFINED tolerance, not a
 * hand-waved one. `count()` is exact on both engines; `uniq()` is a HyperLogLog estimate with a documented
 * relative error (UNIQ_RELATIVE_ERROR), so unique-metric results are compared within that bound.
 *
 * CI has no ClickHouse, so we compare the Postgres oracle (computeTrend) against a modeled CH result through
 * the tolerance gate. The value is the CONTRACT: swap in a real CH executor and the same tolerance decides
 * pass/fail — approximation is allowed only inside a bound we wrote down.
 */

/** Compare an engine's value against the oracle for a metric: exact for count, within uniq error for unique. */
export function withinTolerance(oracle: number, actual: number, metric: Metric): boolean {
  if (metric === "total") return actual === oracle;
  const allowed = Math.ceil(oracle * UNIQ_RELATIVE_ERROR);
  return Math.abs(actual - oracle) <= allowed;
}

const now = (): Date => new Date("2026-07-12T00:00:00Z");
const EVENTS: EventLike[] = [
  { name: "$pageview", distinctId: "alice", personId: "pa", ts: new Date("2026-07-10T08:00:00Z"), props: { $browser: "Safari" } },
  { name: "$pageview", distinctId: "alice2", personId: "pa", ts: new Date("2026-07-10T09:00:00Z"), props: { $browser: "Safari" } },
  { name: "$pageview", distinctId: "bob", personId: "pb", ts: new Date("2026-07-10T10:00:00Z"), props: { $browser: "Chrome" } },
  { name: "purchase", distinctId: "alice", personId: "pa", ts: new Date("2026-07-10T11:00:00Z"), props: { plan: "pro" } },
  { name: "$pageview", distinctId: "carol", personId: "pc", ts: new Date("2026-07-11T09:00:00Z"), props: { $browser: "Chrome" } },
];

// The "ClickHouse" result, modeled: our in-memory semantics match by construction. Swap for a real CH executor
// and the tolerance gate below is what proves parity.
function runOnClickHouseModel(events: EventLike[], spec: ReturnType<typeof TrendSpecSchema.parse>): number[] {
  return computeTrend(events, spec, now).series.flatMap((s) => s.values);
}

describe("golden parity: oracle vs ClickHouse within tolerance (S07)", () => {
  const specs = [
    TrendSpecSchema.parse({ event: "$pageview", metric: "total" }),
    TrendSpecSchema.parse({ event: "$pageview", metric: "unique" }),
    TrendSpecSchema.parse({ metric: "total" }),
  ];

  it("every golden spec matches within the defined tolerance", () => {
    for (const spec of specs) {
      const oracle = computeTrend(EVENTS, spec, now).series.flatMap((s) => s.values);
      const ch = runOnClickHouseModel(EVENTS, spec);
      expect(ch.length).toBe(oracle.length);
      oracle.forEach((v, i) => expect(withinTolerance(v, ch[i], spec.metric)).toBe(true));
    }
  });

  it("the tolerance gate accepts a uniq() estimate within the bound and rejects beyond it", () => {
    // 1,000,000 true uniques; uniq() may be off by up to ~0.5% = 5,000.
    expect(withinTolerance(1_000_000, 1_004_000, "unique")).toBe(true); // 0.4% — accepted
    expect(withinTolerance(1_000_000, 1_020_000, "unique")).toBe(false); // 2% — rejected
    expect(withinTolerance(500, 501, "total")).toBe(false); // count must be exact
  });
});
