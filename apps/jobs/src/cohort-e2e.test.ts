import { describe, it, expect } from "vitest";
import { recomputeCohort, InMemoryMembershipStore, type BehavioralCohortRef } from "./recompute";
import { BehavioralCohortSchema, FunnelSpecSchema, computeFunnel, type EventLike } from "@pulse/insights";

const now = (): Date => new Date("2026-08-10T00:00:00Z");
const ev = (person: string, name: string, iso: string): EventLike => ({ name, distinctId: person, personId: person, props: {}, ts: new Date(iso) });

/**
 * E2E (S09): build a behavioral cohort ("purchased ≥ 2 times") → materialize its membership → filter a funnel by
 * that cohort → the funnel counts only members. The whole loop, on in-memory fakes.
 */
describe("E2E: behavioral cohort → funnel filter (S09)", () => {
  it("a funnel filtered by a behavioral cohort only counts that cohort's members", async () => {
    const events: EventLike[] = [
      // power: 2 purchases → in the cohort; converts the funnel
      ev("power", "purchase", "2026-07-20T00:00:00Z"),
      ev("power", "purchase", "2026-07-25T00:00:00Z"),
      ev("power", "view", "2026-08-01T10:00:00Z"),
      ev("power", "checkout", "2026-08-01T11:00:00Z"),
      // casual: 1 purchase → NOT in the cohort; also converts the funnel, but shouldn't be counted once filtered
      ev("casual", "purchase", "2026-07-25T00:00:00Z"),
      ev("casual", "view", "2026-08-01T10:00:00Z"),
      ev("casual", "checkout", "2026-08-01T11:00:00Z"),
    ];

    // 1. Materialize the behavioral cohort.
    const cohort: BehavioralCohortRef = {
      id: "power-buyers",
      projectId: "p1",
      spec: BehavioralCohortSchema.parse({ kind: "behavioral", event: "purchase", minCount: 2, windowDays: 30 }),
    };
    const store = new InMemoryMembershipStore();
    await recomputeCohort(cohort, events, store, now);
    const members = await store.currentMembers("power-buyers");
    expect(members).toEqual(new Set(["power"]));

    // 2. Funnel over ALL persons vs filtered to the cohort.
    const funnelSpec = FunnelSpecSchema.parse({ steps: [{ event: "view" }, { event: "checkout" }], windowDays: 7, days: 60 });
    const all = computeFunnel(events, funnelSpec, now);
    const filtered = computeFunnel(events.filter((e) => members.has(e.personId ?? e.distinctId)), funnelSpec, now);

    expect(all.steps.map((s) => s.count)).toEqual([2, 2]); // power + casual both convert
    expect(filtered.steps.map((s) => s.count)).toEqual([1, 1]); // only power (the cohort member)
  });
});
