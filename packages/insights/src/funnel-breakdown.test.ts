import { describe, it, expect } from "vitest";
import { computeFunnelBreakdown } from "./funnel";
import { FunnelSpecSchema } from "./funnel-spec";
import type { EventLike } from "./compute";

const now = (): Date => new Date("2026-07-20T00:00:00Z");
const e = (name: string, person: string, iso: string, props: Record<string, unknown> = {}): EventLike => ({
  name,
  distinctId: person,
  personId: person,
  props,
  ts: new Date(iso),
});

describe("funnel breakdown + percentiles (S08)", () => {
  it("splits the funnel by a step-1 property value", () => {
    const spec = FunnelSpecSchema.parse({
      steps: [{ event: "$pageview" }, { event: "purchase" }],
      breakdown: "$browser",
      windowDays: 7,
    });
    const events: EventLike[] = [
      e("$pageview", "a", "2026-07-15T10:00:00Z", { $browser: "Chrome" }),
      e("purchase", "a", "2026-07-15T11:00:00Z"),
      e("$pageview", "b", "2026-07-15T10:00:00Z", { $browser: "Chrome" }),
      e("$pageview", "c", "2026-07-15T10:00:00Z", { $browser: "Safari" }),
      e("purchase", "c", "2026-07-15T11:00:00Z"),
    ];
    const rows = computeFunnelBreakdown(events, spec, now);
    const chrome = rows.find((r) => r.label === "Chrome");
    const safari = rows.find((r) => r.label === "Safari");
    expect(chrome?.result.steps.map((s) => s.count)).toEqual([2, 1]); // 2 entered, 1 bought
    expect(safari?.result.steps.map((s) => s.count)).toEqual([1, 1]); // 1 entered, 1 bought
  });

  it("reports median and p90 time-to-convert", () => {
    const spec = FunnelSpecSchema.parse({ steps: [{ event: "a" }, { event: "b" }], windowDays: 7 });
    const events: EventLike[] = [
      e("a", "p1", "2026-07-15T00:00:00Z"),
      e("b", "p1", "2026-07-15T01:00:00Z"), // 1h
      e("a", "p2", "2026-07-15T00:00:00Z"),
      e("b", "p2", "2026-07-15T10:00:00Z"), // 10h
    ];
    const [{ result }] = computeFunnelBreakdown(events, spec, now);
    expect(result.medianTimeToConvertMs).not.toBeNull();
    expect(result.p90TimeToConvertMs).toBeGreaterThanOrEqual(result.medianTimeToConvertMs!);
  });
});
