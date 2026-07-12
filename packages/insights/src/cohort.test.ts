import { describe, it, expect } from "vitest";
import { personMatchesProperty, computeBehavioralMembers } from "./cohort";
import { CohortSpecSchema, type PropertyCohort, type BehavioralCohort } from "./cohort-spec";
import type { EventLike } from "./compute";

const now = (): Date => new Date("2026-08-01T00:00:00Z");
const ev = (person: string, name: string, iso: string): EventLike => ({ name, distinctId: person, personId: person, props: {}, ts: new Date(iso) });

describe("cohort AST + evaluation (S09)", () => {
  it("one grammar validates both kinds", () => {
    expect(CohortSpecSchema.parse({ kind: "property", filters: [{ property: "plan", op: "eq", value: "pro" }] }).kind).toBe("property");
    expect(CohortSpecSchema.parse({ kind: "behavioral", event: "purchase", minCount: 3, windowDays: 30 }).kind).toBe("behavioral");
    expect(CohortSpecSchema.safeParse({ kind: "nonsense" }).success).toBe(false);
  });

  it("property membership is a cheap predicate over a person's properties", () => {
    const spec: PropertyCohort = { kind: "property", filters: [{ property: "plan", op: "eq", value: "pro" }] };
    expect(personMatchesProperty({ plan: "pro" }, spec)).toBe(true);
    expect(personMatchesProperty({ plan: "free" }, spec)).toBe(false);
  });

  it("behavioral membership is who did the event ≥ minCount times in the window", () => {
    const spec: BehavioralCohort = { kind: "behavioral", event: "purchase", filters: [], minCount: 2, windowDays: 30 };
    const events: EventLike[] = [
      ev("power", "purchase", "2026-07-20T10:00:00Z"),
      ev("power", "purchase", "2026-07-25T10:00:00Z"), // power: 2 → in
      ev("casual", "purchase", "2026-07-25T10:00:00Z"), // casual: 1 → out
      ev("old", "purchase", "2026-05-01T10:00:00Z"), // outside the 30-day window → out
      ev("old", "purchase", "2026-05-02T10:00:00Z"),
    ];
    const members = computeBehavioralMembers(events, spec, now);
    expect([...members].sort()).toEqual(["power"]);
  });
});
