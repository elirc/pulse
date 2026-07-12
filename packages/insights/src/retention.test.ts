import { describe, it, expect } from "vitest";
import { computeRetention, periodStartMs, type RetentionSpec } from "./retention";
import type { EventLike } from "./compute";

const now = (): Date => new Date("2026-08-01T00:00:00Z");
const ev = (person: string, iso: string): EventLike => ({ name: "$pageview", distinctId: person, personId: person, props: {}, ts: new Date(iso) });

const SPEC: RetentionSpec = { granularity: "day", periods: 3, days: 30 };

describe("retention (S09)", () => {
  it("buckets by first-seen day and counts returns per offset", () => {
    const events: EventLike[] = [
      // alice: first seen day 10; returns day 11 (p1) and day 13 (p3), not day 12 (p2)
      ev("alice", "2026-07-10T09:00:00Z"),
      ev("alice", "2026-07-11T09:00:00Z"),
      ev("alice", "2026-07-13T09:00:00Z"),
      // bob: first seen day 10; returns day 11 only
      ev("bob", "2026-07-10T10:00:00Z"),
      ev("bob", "2026-07-11T10:00:00Z"),
      // carol: first seen day 11; no returns
      ev("carol", "2026-07-11T10:00:00Z"),
    ];
    const r = computeRetention(events, SPEC, now);
    const day10 = r.cohorts.find((c) => c.bucket === "2026-07-10")!;
    const day11 = r.cohorts.find((c) => c.bucket === "2026-07-11")!;
    expect(day10.size).toBe(2); // alice, bob
    expect(day10.retained).toEqual([2, 2, 0, 1]); // p0=2, p1 both returned, p2 none, p3 alice
    expect(day11.size).toBe(1); // carol
    expect(day11.retained).toEqual([1, 0, 0, 0]);
  });

  it("week bucketing anchors on Monday (UTC)", () => {
    // 2026-07-10 is a Friday; its week starts Monday 2026-07-06.
    expect(new Date(periodStartMs(new Date("2026-07-10T12:00:00Z").getTime(), "week")).toISOString().slice(0, 10)).toBe("2026-07-06");
  });
});
