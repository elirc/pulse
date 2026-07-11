import { describe, it, expect } from "vitest";
import { computeTrend, type EventLike } from "./compute";
import { TrendSpecSchema } from "./spec";

/**
 * Golden fixtures (S05): a small, hand-listed dataset with expected counts computed BY HAND, so a human can
 * verify the interpreter is right by reading the fixture. This is the reconciliation oracle — the known-correct
 * answer the SQL/ClickHouse paths get checked against (the pattern S07's migration verification relies on).
 *
 * Dataset (all 2026-07, UTC), `now` pinned to the 12th so everything is in the 30-day window:
 *   day 10: alice $pageview, alice $pageview, bob $pageview  (bob on Chrome; alice on Safari)
 *   day 10: alice purchase (plan=pro)
 *   day 11: carol $pageview (Chrome), bob purchase (plan=free)
 */
const D = (iso: string): Date => new Date(iso);
const EVENTS: EventLike[] = [
  { name: "$pageview", distinctId: "alice", ts: D("2026-07-10T08:00:00Z"), props: { $browser: "Safari" } },
  { name: "$pageview", distinctId: "alice", ts: D("2026-07-10T09:00:00Z"), props: { $browser: "Safari" } },
  { name: "$pageview", distinctId: "bob", ts: D("2026-07-10T10:00:00Z"), props: { $browser: "Chrome" } },
  { name: "purchase", distinctId: "alice", ts: D("2026-07-10T11:00:00Z"), props: { plan: "pro" } },
  { name: "$pageview", distinctId: "carol", ts: D("2026-07-11T09:00:00Z"), props: { $browser: "Chrome" } },
  { name: "purchase", distinctId: "bob", ts: D("2026-07-11T10:00:00Z"), props: { plan: "free" } },
];
const now = (): Date => new Date("2026-07-12T00:00:00Z");

describe("trend golden fixtures (S05)", () => {
  it("$pageview total by day = [3, 1]", () => {
    const r = computeTrend(EVENTS, TrendSpecSchema.parse({ event: "$pageview", metric: "total" }), now);
    expect(r.buckets).toEqual(["2026-07-10", "2026-07-11"]);
    expect(r.series[0].values).toEqual([3, 1]); // day10: 3 pageviews, day11: 1
  });

  it("$pageview unique persons by day = [2, 1] (alice counted once on the 10th)", () => {
    const r = computeTrend(EVENTS, TrendSpecSchema.parse({ event: "$pageview", metric: "unique" }), now);
    expect(r.series[0].values).toEqual([2, 1]);
  });

  it("purchase filtered plan=pro = [1] on day 10 only", () => {
    const r = computeTrend(
      EVENTS,
      TrendSpecSchema.parse({ event: "purchase", filters: [{ property: "plan", op: "eq", value: "pro" }] }),
      now,
    );
    expect(r.buckets).toEqual(["2026-07-10"]);
    expect(r.series[0].values).toEqual([1]);
  });

  it("$pageview broken down by $browser: Chrome [1,1], Safari [2,0]", () => {
    const r = computeTrend(EVENTS, TrendSpecSchema.parse({ event: "$pageview", breakdown: "$browser" }), now);
    const chrome = r.series.find((s) => s.label === "Chrome");
    const safari = r.series.find((s) => s.label === "Safari");
    expect(chrome?.values).toEqual([1, 1]); // bob day10, carol day11
    expect(safari?.values).toEqual([2, 0]); // alice ×2 day10, none day11
  });

  it("all-events total by day = [4, 2]", () => {
    const r = computeTrend(EVENTS, TrendSpecSchema.parse({ metric: "total" }), now);
    expect(r.series[0].values).toEqual([4, 2]); // day10: 3 pv + 1 purchase; day11: 1 pv + 1 purchase
  });
});
