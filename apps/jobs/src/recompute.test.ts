import { describe, it, expect } from "vitest";
import { recomputeCohort, InMemoryMembershipStore, type BehavioralCohortRef } from "./recompute";
import { BehavioralCohortSchema, type EventLike } from "@pulse/insights";

const now = (): Date => new Date("2026-08-01T00:00:00Z");
const ev = (person: string, iso: string): EventLike => ({ name: "purchase", distinctId: person, personId: person, props: {}, ts: new Date(iso) });

const cohort: BehavioralCohortRef = {
  id: "c1",
  projectId: "p1",
  spec: BehavioralCohortSchema.parse({ kind: "behavioral", event: "purchase", minCount: 2, windowDays: 30 }),
};

describe("behavioral cohort recompute (S09)", () => {
  it("materializes members and reports the diff", async () => {
    const store = new InMemoryMembershipStore();
    const events: EventLike[] = [ev("power", "2026-07-20T00:00:00Z"), ev("power", "2026-07-25T00:00:00Z"), ev("casual", "2026-07-25T00:00:00Z")];
    const diff = await recomputeCohort(cohort, events, store, now);
    expect(diff.added).toEqual(["power"]);
    expect(diff.removed).toEqual([]);
    expect(diff.size).toBe(1);
    expect(await store.currentMembers("c1")).toEqual(new Set(["power"]));
    expect(store.computedAt.get("c1")).toEqual(now());
  });

  it("is idempotent — a second recompute over the same events yields an empty diff", async () => {
    const store = new InMemoryMembershipStore();
    const events: EventLike[] = [ev("power", "2026-07-20T00:00:00Z"), ev("power", "2026-07-25T00:00:00Z")];
    await recomputeCohort(cohort, events, store, now);
    const second = await recomputeCohort(cohort, events, store, now);
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  it("logs churn: a member who drops below the threshold is removed", async () => {
    const store = new InMemoryMembershipStore();
    await recomputeCohort(cohort, [ev("power", "2026-07-20T00:00:00Z"), ev("power", "2026-07-25T00:00:00Z")], store, now);
    // Next run: only one purchase in window → no longer qualifies.
    const diff = await recomputeCohort(cohort, [ev("power", "2026-07-25T00:00:00Z")], store, now);
    expect(diff.removed).toEqual(["power"]);
    expect(await store.currentMembers("c1")).toEqual(new Set());
  });
});
