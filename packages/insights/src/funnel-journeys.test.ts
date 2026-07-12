import { describe, it, expect } from "vitest";
import { computeFunnel } from "./funnel";
import { computeFunnelNaive } from "./funnel-naive";
import { FunnelSpecSchema } from "./funnel-spec";
import type { EventLike } from "./compute";

/**
 * Journey fixtures (S08): 12 hand-traced personas exercising the funnel semantics, each documented so a human
 * can verify. The spec: view → signup → purchase, 7-day window anchored at step 1, ordered-with-gaps.
 * Both implementations (naive oracle + single-pass) must agree on every fixture.
 */
const now = (): Date => new Date("2026-07-31T00:00:00Z");
const t = (day: number, hour = 10): Date => new Date(`2026-07-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);
const ev = (name: string, person: string, when: Date): EventLike => ({ name, distinctId: person, personId: person, props: {}, ts: when });

const SPEC = FunnelSpecSchema.parse({
  steps: [{ event: "view" }, { event: "signup" }, { event: "purchase" }],
  windowDays: 7,
  days: 60,
});

const JOURNEYS: EventLike[] = [
  // 1. p1 — full convert, same day
  ev("view", "p1", t(10)), ev("signup", "p1", t(10, 11)), ev("purchase", "p1", t(10, 12)),
  // 2. p2 — full convert with a GAP (extra view between) — ordered-with-gaps still counts
  ev("view", "p2", t(10)), ev("view", "p2", t(10, 5)), ev("signup", "p2", t(11)), ev("purchase", "p2", t(12)),
  // 3. p3 — converts right at the window edge (day 10 → day 17 = exactly 7 days)
  ev("view", "p3", t(10)), ev("signup", "p3", t(12)), ev("purchase", "p3", t(17)),
  // 4. p4 — purchase ONE day past the window (day 18) — must NOT count as converted
  ev("view", "p4", t(10)), ev("signup", "p4", t(12)), ev("purchase", "p4", t(18)),
  // 5. p5 — drops after signup (no purchase)
  ev("view", "p5", t(11)), ev("signup", "p5", t(12)),
  // 6. p6 — drops after view (no signup)
  ev("view", "p6", t(11)),
  // 7. p7 — OUT OF ORDER: signup + purchase BEFORE the view — only the view counts (B…A ≠ A…B)
  ev("signup", "p7", t(9)), ev("purchase", "p7", t(9, 5)), ev("view", "p7", t(10)),
  // 8. p8 — repeated views then converts (earliest view is the anchor)
  ev("view", "p8", t(10)), ev("view", "p8", t(11)), ev("signup", "p8", t(12)), ev("purchase", "p8", t(13)),
  // 9. p9 — signup then view then purchase: the view resets nothing; signup was before step 1 so it doesn't count,
  //         but a LATER signup would. Here no later signup → stops at view.
  ev("signup", "p9", t(9)), ev("view", "p9", t(10)), ev("purchase", "p9", t(11)),
  // 10. p10 — full convert spanning several days within window
  ev("view", "p10", t(20)), ev("signup", "p10", t(23)), ev("purchase", "p10", t(26)),
  // 11. p11 — only signup+purchase, never viewed → not in funnel at all
  ev("signup", "p11", t(15)), ev("purchase", "p11", t(15, 5)),
  // 12. p12 — view, then signup exactly at window edge, purchase just after step-1 window edge → signup counts,
  //           purchase is past the window (anchored at step 1 = day 10; day 18 > day 17)
  ev("view", "p12", t(10)), ev("signup", "p12", t(17)), ev("purchase", "p12", t(18)),
];

describe("funnel journey fixtures (S08)", () => {
  // Hand count of step-1 (view): p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p12 = 11 (p11 never viewed).
  // step-2 (signup after view, in window): p1,p2,p3,p4,p5,p8,p10,p12 = 8 (p6 no signup; p7/p9 signup before view).
  // step-3 (purchase after signup, in window): p1,p2,p3,p8,p10 = 5 (p4/p12 past window; p5 no purchase).
  it("aggregate funnel counts match the hand trace [11, 8, 5]", () => {
    const r = computeFunnel(JOURNEYS, SPEC, now);
    expect(r.steps.map((s) => s.count)).toEqual([11, 8, 5]);
  });

  it("the single-pass result matches the naive oracle on every persona", () => {
    const fast = computeFunnel(JOURNEYS, SPEC, now);
    const oracle = computeFunnelNaive(JOURNEYS, SPEC, now);
    expect(fast.steps.map((s) => s.count)).toEqual(oracle.steps.map((s) => s.count));
  });

  it("documents the order semantics: A…B counts (p2), B…A does not (p7)", () => {
    // p2 has a gap between view and signup and still converts; p7 did signup+purchase before its view and gets
    // stuck at step 1. Ordered-with-gaps: sequence matters, intervening events don't.
    const solo = (evs: EventLike[]): number[] => computeFunnel(evs, SPEC, now).steps.map((s) => s.count);
    expect(solo(JOURNEYS.filter((e) => e.personId === "p2"))).toEqual([1, 1, 1]);
    expect(solo(JOURNEYS.filter((e) => e.personId === "p7"))).toEqual([1, 0, 0]);
  });
});
