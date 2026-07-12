import { describe, it, expect } from "vitest";
import { isRollupEligible, compileTrendRollup, routeTrend } from "./rollup";
import { TrendSpecSchema } from "./spec";

const spec = (over: Record<string, unknown> = {}): ReturnType<typeof TrendSpecSchema.parse> => TrendSpecSchema.parse(over);

describe("rollup routing (S12)", () => {
  it("routes a plain daily count/unique for one event to the rollup", () => {
    expect(isRollupEligible(spec({ event: "$pageview", metric: "total", interval: "day" }))).toBe(true);
    expect(isRollupEligible(spec({ event: "$pageview", metric: "unique", interval: "day" }))).toBe(true);
    expect(routeTrend(spec({ event: "$pageview" }))).toBe("rollup");
  });

  it("keeps filtered / broken-down / non-day / all-event queries on the raw path", () => {
    expect(isRollupEligible(spec({ event: "e", filters: [{ property: "plan", op: "eq", value: "pro" }] }))).toBe(false);
    expect(isRollupEligible(spec({ event: "e", breakdown: "$browser" }))).toBe(false);
    expect(isRollupEligible(spec({ event: "e", interval: "week" }))).toBe(false);
    expect(isRollupEligible(spec({ metric: "total" }))).toBe(false); // no event
    expect(routeTrend(spec({ event: "e", breakdown: "x" }))).toBe("raw");
  });

  it("the rollup query reads events_daily with merge functions and bound params", () => {
    const total = compileTrendRollup(spec({ event: "$pageview", metric: "total" }), "p1");
    expect(total.text).toContain("FROM events_daily");
    expect(total.text).toContain("sumMerge(count)");
    const unique = compileTrendRollup(spec({ event: "$pageview", metric: "unique" }), "p1");
    expect(unique.text).toContain("uniqMerge(uniqs)");
    expect(Object.values(total.params)).toContain("$pageview");
  });
});
