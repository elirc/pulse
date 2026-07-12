import { describe, it, expect } from "vitest";
import { recomputeCohort, InMemoryMembershipStore, type BehavioralCohortRef, type MembershipDiff } from "./recompute";
import { BehavioralCohortSchema, type EventLike } from "@pulse/insights";

const ev = (person: string, iso: string): EventLike => ({ name: "purchase", distinctId: person, personId: person, props: {}, ts: new Date(iso) });
const cohort: BehavioralCohortRef = {
  id: "c1",
  projectId: "p1",
  spec: BehavioralCohortSchema.parse({ kind: "behavioral", event: "purchase", minCount: 1, windowDays: 30 }),
};

describe("staleness metadata + membership diff logging (S09)", () => {
  it("stamps computedAt each run and logs the churn between runs", async () => {
    const store = new InMemoryMembershipStore();
    const log: MembershipDiff[] = [];

    // Run 1 at 12:00 — alice & bob qualify.
    log.push(await recomputeCohort(cohort, [ev("alice", "2026-07-20T00:00:00Z"), ev("bob", "2026-07-20T00:00:00Z")], store, () => new Date("2026-08-01T12:00:00Z")));
    expect(store.computedAt.get("c1")).toEqual(new Date("2026-08-01T12:00:00Z"));
    expect(log[0].added.sort()).toEqual(["alice", "bob"]);

    // Run 2 at 13:00 — bob churned out, carol churned in.
    log.push(await recomputeCohort(cohort, [ev("alice", "2026-07-20T00:00:00Z"), ev("carol", "2026-07-21T00:00:00Z")], store, () => new Date("2026-08-01T13:00:00Z")));
    expect(store.computedAt.get("c1")).toEqual(new Date("2026-08-01T13:00:00Z")); // staleness advanced
    expect(log[1].added).toEqual(["carol"]);
    expect(log[1].removed).toEqual(["bob"]);

    // The diff log is the cohort's black box: a silent 40% shrink would show up as a big `removed` list.
    const totalRemoved = log.flatMap((d) => d.removed).length;
    expect(totalRemoved).toBe(1);
  });
});
