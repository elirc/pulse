import { describe, it, expect } from "vitest";
import { reconcile, type EventRow } from "./reconcile";
import { clickhouseContents, planBackfillUpTo } from "./migration";
import type { StorableEvent } from "./store";

function ev(uuid: string, day: string, personId = "person1"): StorableEvent {
  return { uuid, projectId: "p1", distinctId: "u1", personId, name: "$pageview", props: {}, ts: `2026-07-${day}T12:00:00.000Z`, ingestedAt: `2026-07-${day}T12:00:00.000Z` };
}

// PG history: events every day 01–10. Dual-write engaged on the 8th; the backfill snapshot was the 5th (deploy
// lag). Days 05,06,07 are the gap: written to PG after the snapshot but before the shadow turned on.
const PG: StorableEvent[] = Array.from({ length: 10 }, (_, i) => ev(`e${i}`, String(i + 1).padStart(2, "0"), `person${i}`));
const DUAL_WRITE_FROM = "2026-07-08T00:00:00.000Z";
const BACKFILL_SNAPSHOT = "2026-07-05T00:00:00.000Z";

const asRows = (evs: StorableEvent[]): EventRow[] => evs.map((e) => ({ ts: e.ts, projectId: e.projectId, personId: e.personId }));

/**
 * [in-PR arc] The backfill raced the dual-write start. This spec asserts the migration reconciles CLEAN and it
 * FAILS: the buggy boundary (stop at the snapshot) leaves days 05/06/07 in neither the backfill nor the shadow.
 * The next commit fixes it with an overlap window; dedupe absorbs the overlap.
 */
describe("reconciliation: PG vs CH (S07)", () => {
  it("reconciles clean after the migration", () => {
    const backfillUpTo = planBackfillUpTo(BACKFILL_SNAPSHOT, DUAL_WRITE_FROM);
    const ch = clickhouseContents(PG, DUAL_WRITE_FROM, backfillUpTo);
    const result = reconcile(asRows(PG), asRows(ch));
    expect(result.ok).toBe(true);
  });
});
