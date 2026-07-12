import { describe, it, expect, afterAll } from "vitest";
import { buildApiServer, type EventFetcher } from "./server";
import { compileTrendClickhouse, TrendSpecSchema, type EventLike } from "@pulse/insights";

const ev = (person: string, iso: string): EventLike => ({ name: "$pageview", distinctId: person, personId: person, props: {}, ts: new Date(iso) });

// All events; the cohort restricts to {alice}.
const ALL: EventLike[] = [ev("alice", "2026-07-10T10:00:00Z"), ev("bob", "2026-07-10T11:00:00Z"), ev("carol", "2026-07-11T10:00:00Z")];
const chEvents: EventFetcher = () => Promise.resolve(ALL);
const cohortMembers = (): Promise<Set<string>> => Promise.resolve(new Set(["alice"]));

const app = buildApiServer({ chEvents, cohortMembers });
afterAll(async () => {
  await app.close();
});

describe("cohort filters across query paths (S09)", () => {
  it("retention filtered by a cohort only counts that cohort's members", async () => {
    const unfiltered = await app.inject({ method: "POST", url: "/insights/retention", payload: { spec: { granularity: "day", periods: 2, days: 30 } } });
    const filtered = await app.inject({ method: "POST", url: "/insights/retention", payload: { cohort: "c1", spec: { granularity: "day", periods: 2, days: 30 } } });
    const totalSize = (r: { cohorts: Array<{ size: number }> }): number => r.cohorts.reduce((a, c) => a + c.size, 0);
    expect(totalSize(unfiltered.json())).toBe(3); // alice, bob, carol
    expect(totalSize(filtered.json())).toBe(1); // alice only
  });

  it("the trend compiler adds a membership IN-clause for cohort-filtered trends", () => {
    const { text, params } = compileTrendClickhouse(TrendSpecSchema.parse({}), "p1", { cohortMembers: ["alice", "carol"] });
    expect(text).toMatch(/IN \{p\d+:Array\(String\)\}/);
    expect(Object.values(params)).toContainEqual(["alice", "carol"]);
  });
});
