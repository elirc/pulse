import { describe, it, expect } from "vitest";
import { foldTopNRows } from "./pivot";
import { computeTrend, type EventLike } from "./compute";
import { TrendSpecSchema } from "./spec";

describe("foldTopNRows (S05 breakdown top-N)", () => {
  it("keeps the top-N labels and folds the rest into Other, per bucket", () => {
    const rows = [
      { bucket: "2026-07-10", label: "Chrome", value: 10 },
      { bucket: "2026-07-10", label: "Safari", value: 5 },
      { bucket: "2026-07-10", label: "Firefox", value: 2 },
      { bucket: "2026-07-10", label: "Edge", value: 1 },
    ];
    const folded = foldTopNRows(rows, 2);
    expect(folded).toContainEqual({ bucket: "2026-07-10", label: "Chrome", value: 10 });
    expect(folded).toContainEqual({ bucket: "2026-07-10", label: "Safari", value: 5 });
    expect(folded).toContainEqual({ bucket: "2026-07-10", label: "Other", value: 3 }); // Firefox+Edge
    expect(folded).toHaveLength(3);
  });
});

describe("computeTrend golden fixtures (S05)", () => {
  const ev = (name: string, distinctId: string, ts: string, props: Record<string, unknown> = {}): EventLike => ({
    name,
    distinctId,
    props,
    ts: new Date(ts),
  });
  const now = (): Date => new Date("2026-07-12T00:00:00Z");

  it("totals vs unique persons, bucketed by day", () => {
    const events = [
      ev("$pageview", "u1", "2026-07-10T09:00:00Z"),
      ev("$pageview", "u1", "2026-07-10T10:00:00Z"), // same person, same day
      ev("$pageview", "u2", "2026-07-10T11:00:00Z"),
      ev("$pageview", "u3", "2026-07-11T09:00:00Z"),
    ];
    const total = computeTrend(events, TrendSpecSchema.parse({ event: "$pageview", metric: "total" }), now);
    expect(total.buckets).toEqual(["2026-07-10", "2026-07-11"]);
    expect(total.series[0].values).toEqual([3, 1]);

    const unique = computeTrend(events, TrendSpecSchema.parse({ event: "$pageview", metric: "unique" }), now);
    expect(unique.series[0].values).toEqual([2, 1]); // u1 counted once on the 10th
  });

  it("property filters narrow the count", () => {
    const events = [
      ev("purchase", "u1", "2026-07-11T09:00:00Z", { plan: "pro" }),
      ev("purchase", "u2", "2026-07-11T10:00:00Z", { plan: "free" }),
    ];
    const spec = TrendSpecSchema.parse({ event: "purchase", filters: [{ property: "plan", op: "eq", value: "pro" }] });
    expect(computeTrend(events, spec, now).series[0].values).toEqual([1]);
  });

  it("breakdown by property yields one series per value", () => {
    const events = [
      ev("$pageview", "u1", "2026-07-11T09:00:00Z", { $browser: "Chrome" }),
      ev("$pageview", "u2", "2026-07-11T10:00:00Z", { $browser: "Chrome" }),
      ev("$pageview", "u3", "2026-07-11T11:00:00Z", { $browser: "Safari" }),
    ];
    const spec = TrendSpecSchema.parse({ event: "$pageview", breakdown: "$browser" });
    const result = computeTrend(events, spec, now);
    const chrome = result.series.find((s) => s.label === "Chrome");
    const safari = result.series.find((s) => s.label === "Safari");
    expect(chrome?.values).toEqual([2]);
    expect(safari?.values).toEqual([1]);
  });
});
