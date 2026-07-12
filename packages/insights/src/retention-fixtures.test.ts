import { describe, it, expect } from "vitest";
import { computeRetention, periodStartMs, type RetentionSpec } from "./retention";
import type { EventLike } from "./compute";

const now = (): Date => new Date("2026-09-01T00:00:00Z");
const ev = (person: string, iso: string): EventLike => ({ name: "$pageview", distinctId: person, personId: person, props: {}, ts: new Date(iso) });

// Weekly retention, 4 return periods. Weeks anchor Monday UTC.
const SPEC: RetentionSpec = { granularity: "week", periods: 4, days: 90 };

describe("retention fixtures across weeks (S09)", () => {
  it("hand-traced weekly cohorts", () => {
    // Week of Mon 2026-07-06. alice first-seen that week, returns weeks +1 and +3.
    const events: EventLike[] = [
      ev("alice", "2026-07-08T10:00:00Z"), // W0 (Wed)
      ev("alice", "2026-07-15T10:00:00Z"), // W1
      ev("alice", "2026-07-29T10:00:00Z"), // W3
      ev("bob", "2026-07-06T00:00:01Z"), // W0 (Mon 00:00) — same cohort as alice
      ev("bob", "2026-07-13T10:00:00Z"), // W1
      ev("carol", "2026-07-13T10:00:00Z"), // W1 cohort, no returns
    ];
    const r = computeRetention(events, SPEC, now);
    const w0 = r.cohorts.find((c) => c.bucket === "2026-07-06")!;
    const w1 = r.cohorts.find((c) => c.bucket === "2026-07-13")!;
    expect(w0.size).toBe(2); // alice + bob
    expect(w0.retained).toEqual([2, 2, 0, 1, 0]); // both back W1; alice back W3
    expect(w1.size).toBe(1); // carol
    expect(w1.retained).toEqual([1, 0, 0, 0, 0]);
  });

  it("timezone/boundary: an event at Sunday 23:59 UTC belongs to that week, Monday 00:00 to the next", () => {
    // Sun 2026-07-12 23:59Z is in the week of Mon 2026-07-06; Mon 2026-07-13 00:00Z starts the next week.
    expect(new Date(periodStartMs(new Date("2026-07-12T23:59:59Z").getTime(), "week")).toISOString().slice(0, 10)).toBe("2026-07-06");
    expect(new Date(periodStartMs(new Date("2026-07-13T00:00:00Z").getTime(), "week")).toISOString().slice(0, 10)).toBe("2026-07-13");
  });

  it("a return exactly at the period start counts (inclusive lower bound)", () => {
    const events: EventLike[] = [
      ev("d", "2026-07-06T10:00:00Z"), // W0
      ev("d", "2026-07-13T00:00:00Z"), // exactly the start of W1
    ];
    const r = computeRetention(events, SPEC, now);
    expect(r.cohorts[0].retained[1]).toBe(1); // counted in W1
  });
});
