import { describe, it, expect } from "vitest";
import { computeFunnelNaive } from "./funnel-naive";
import { FunnelSpecSchema } from "./funnel-spec";
import type { EventLike } from "./compute";

const now = (): Date => new Date("2026-07-20T00:00:00Z");
const D = (iso: string): Date => new Date(iso);
const e = (name: string, person: string, iso: string): EventLike => ({ name, distinctId: person, personId: person, props: {}, ts: D(iso) });

const SPEC = FunnelSpecSchema.parse({
  steps: [{ event: "$pageview" }, { event: "signup_started" }, { event: "purchase" }],
  windowDays: 7,
  days: 30,
});

describe("[J] computeFunnelNaive correctness (S08)", () => {
  it("counts ordered-with-gaps conversion per step", () => {
    const events: EventLike[] = [
      // alice: full funnel within window (a pageview in between is fine — ordered WITH gaps)
      e("$pageview", "alice", "2026-07-15T10:00:00Z"),
      e("$pageview", "alice", "2026-07-15T10:05:00Z"),
      e("signup_started", "alice", "2026-07-15T11:00:00Z"),
      e("purchase", "alice", "2026-07-16T09:00:00Z"),
      // bob: reaches step 2, never purchases
      e("$pageview", "bob", "2026-07-15T10:00:00Z"),
      e("signup_started", "bob", "2026-07-15T12:00:00Z"),
      // carol: only step 1
      e("$pageview", "carol", "2026-07-15T10:00:00Z"),
    ];
    const r = computeFunnelNaive(events, SPEC, now);
    expect(r.steps.map((s) => s.count)).toEqual([3, 2, 1]); // 3 entered, 2 signed up, 1 bought
    expect(r.steps[2].conversionFromStart).toBeCloseTo(1 / 3);
    expect(r.steps[1].conversionFromPrev).toBeCloseTo(2 / 3);
  });

  it("drops a conversion that falls OUTSIDE the window (anchored at step 1)", () => {
    const events: EventLike[] = [
      e("$pageview", "dave", "2026-07-01T10:00:00Z"),
      e("signup_started", "dave", "2026-07-01T11:00:00Z"),
      e("purchase", "dave", "2026-07-15T09:00:00Z"), // 14 days after step 1 — past the 7-day window
    ];
    const r = computeFunnelNaive(events, SPEC, now);
    expect(r.steps.map((s) => s.count)).toEqual([1, 1, 0]); // purchase too late
  });

  it("requires order: B before A does not count as A→B", () => {
    const events: EventLike[] = [
      e("signup_started", "erin", "2026-07-15T10:00:00Z"), // step 2 event first
      e("$pageview", "erin", "2026-07-15T11:00:00Z"), // step 1 after
    ];
    const r = computeFunnelNaive(events, SPEC, now);
    expect(r.steps.map((s) => s.count)).toEqual([1, 0, 0]); // entered step 1, but signup was before it
  });
});
