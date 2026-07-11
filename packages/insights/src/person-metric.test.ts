import { describe, it, expect } from "vitest";
import { computeTrend, type EventLike } from "./compute";
import { TrendSpecSchema } from "./spec";
import { compileTrendSql } from "./sql";

const now = (): Date => new Date("2026-07-12T00:00:00Z");

/**
 * The metric change (S06): unique users count distinct PERSON, not distinctId. One human on two devices is one
 * user — the new number is the TRUE one. This documents the before/after that the commit body calls out.
 */
describe("unique metric counts persons, not distinctIds (S06)", () => {
  it("two devices of one identified person count as ONE unique user", () => {
    const events: EventLike[] = [
      { name: "$pageview", distinctId: "phone", personId: "p1", props: {}, ts: new Date("2026-07-11T09:00:00Z") },
      { name: "$pageview", distinctId: "laptop", personId: "p1", props: {}, ts: new Date("2026-07-11T10:00:00Z") },
      { name: "$pageview", distinctId: "other", personId: "p2", props: {}, ts: new Date("2026-07-11T11:00:00Z") },
    ];
    const spec = TrendSpecSchema.parse({ event: "$pageview", metric: "unique" });
    // BEFORE (distinctId): phone/laptop/other = 3. AFTER (personId): p1, p1, p2 = 2 — the true count.
    expect(computeTrend(events, spec, now).series[0].values).toEqual([2]);
  });

  it("the SQL counts distinct person with a distinctId fallback", () => {
    const { text } = compileTrendSql(TrendSpecSchema.parse({ metric: "unique" }), "p1");
    expect(text).toContain('count(distinct coalesce("personId", "distinctId"))');
  });
});
