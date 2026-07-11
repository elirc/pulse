import { describe, it, expect } from "vitest";
import { EventInputSchema, eventTime, aggregateDailyCounts, dayKey } from "./index";

describe("event input schema (S01)", () => {
  it("accepts a well-formed event and defaults props to {}", () => {
    const parsed = EventInputSchema.parse({ name: "$pageview", distinctId: "u1" });
    expect(parsed).toMatchObject({ name: "$pageview", distinctId: "u1", props: {} });
  });

  it("rejects a missing name or distinctId", () => {
    expect(EventInputSchema.safeParse({ distinctId: "u1" }).success).toBe(false);
    expect(EventInputSchema.safeParse({ name: "$pageview" }).success).toBe(false);
    expect(EventInputSchema.safeParse({ name: "", distinctId: "u1" }).success).toBe(false);
  });
});

describe("eventTime — client clock normalization (S01)", () => {
  const now = () => new Date("2026-07-11T00:00:00Z");
  it("parses an epoch-ms number and an ISO string", () => {
    expect(eventTime(1700000000000).getTime()).toBe(1700000000000);
    expect(eventTime("2026-01-02T03:04:05Z").toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });
  it("falls back to now() when absent or unparseable", () => {
    expect(eventTime(undefined, now).getTime()).toBe(now().getTime());
    expect(eventTime("not-a-date", now).getTime()).toBe(now().getTime());
  });
});

describe("aggregateDailyCounts (S02)", () => {
  it("buckets events by UTC day, ascending", () => {
    const events = [
      { ts: new Date("2026-07-11T09:00:00Z") },
      { ts: new Date("2026-07-11T23:30:00Z") },
      { ts: new Date("2026-07-10T01:00:00Z") },
    ];
    expect(aggregateDailyCounts(events)).toEqual([
      { day: "2026-07-10", count: 1 },
      { day: "2026-07-11", count: 2 },
    ]);
  });

  it("returns an empty array for no events; dayKey is the UTC date", () => {
    expect(aggregateDailyCounts([])).toEqual([]);
    expect(dayKey(new Date("2026-07-11T23:59:59Z"))).toBe("2026-07-11");
  });
});
