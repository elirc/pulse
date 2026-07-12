import { describe, it, expect } from "vitest";
import { computeFunnel } from "./funnel";
import { FunnelSpecSchema } from "./funnel-spec";
import type { EventLike } from "./compute";

/**
 * Window-boundary cases (S08) — the off-by-one museum of funnel analytics. Every one of these is a decision
 * that, left implicit, gives two analysts two truths. We DECIDE, document, and test:
 *   • the conversion window is INCLUSIVE of its edge (≤ anchor + window);
 *   • same-timestamp steps advance in the order the events are stored (stable), and a true tie must be resolved
 *     by that order, not by luck.
 */
const now = (): Date => new Date("2026-08-01T00:00:00Z");
const ev = (name: string, person: string, iso: string): EventLike => ({ name, distinctId: person, personId: person, props: {}, ts: new Date(iso) });

const SPEC = FunnelSpecSchema.parse({ steps: [{ event: "view" }, { event: "buy" }], windowDays: 7, days: 60 });
const ANCHOR = "2026-07-10T10:00:00.000Z";
const EDGE = "2026-07-17T10:00:00.000Z"; // exactly 7 days after the anchor
const PAST_EDGE = "2026-07-17T10:00:00.001Z"; // 1ms past

describe("funnel window boundaries (S08)", () => {
  it("counts a conversion at EXACTLY the window edge (inclusive)", () => {
    const r = computeFunnel([ev("view", "p", ANCHOR), ev("buy", "p", EDGE)], SPEC, now);
    expect(r.steps.map((s) => s.count)).toEqual([1, 1]);
  });

  it("does NOT count a conversion one millisecond past the edge", () => {
    const r = computeFunnel([ev("view", "p", ANCHOR), ev("buy", "p", PAST_EDGE)], SPEC, now);
    expect(r.steps.map((s) => s.count)).toEqual([1, 0]);
  });

  it("same-timestamp steps: step-2 at the same instant as step-1 still advances (edge ≤)", () => {
    const r = computeFunnel([ev("view", "p", ANCHOR), ev("buy", "p", ANCHOR)], SPEC, now);
    expect(r.steps.map((s) => s.count)).toEqual([1, 1]);
  });

  it("same-timestamp tie resolved by stored order: step-2 BEFORE step-1 at the same ts does not convert", () => {
    // buy listed first, both at the anchor instant. Stable order means we see 'buy' at level 0 (ignored, not
    // step 1), then 'view' → level 1; the buy has already passed. Documented, not accidental.
    const r = computeFunnel([ev("buy", "p", ANCHOR), ev("view", "p", ANCHOR)], SPEC, now);
    expect(r.steps.map((s) => s.count)).toEqual([1, 0]);
  });
});
