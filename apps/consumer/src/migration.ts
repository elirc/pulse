/**
 * Migration boundary planning (S07, Act 3). ClickHouse ends up with the union of what dual-write captured
 * (events at ts >= dualWriteFrom) and what backfill copied (events at ts < backfillUpTo). Where those two
 * boundaries meet is the whole game: leave a gap and CH silently loses events; overlap and dedupe absorbs it.
 */
import type { StorableEvent } from "./store";

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Days the backfill deliberately overlaps PAST the dual-write start, to absorb boundary skew. Dedupe (uuid)
 *  makes the overlap free of double-counts. */
export const BACKFILL_OVERLAP_DAYS = 2;

/**
 * Where should backfill stop? Not at its own snapshot (that races the dual-write start and leaves a gap).
 * Instead, backfill everything up to the dual-write start PLUS an overlap window. The overlap region is written
 * by both backfill and the shadow, but uuid dedupe collapses it — so there is no gap and no double-count.
 * Start the shadow first, then backfill up to and past it: overlap is safe, gaps are not.
 */
export function planBackfillUpTo(_backfillSnapshot: string, dualWriteFrom: string): string {
  return addDays(dualWriteFrom, BACKFILL_OVERLAP_DAYS);
}

/** The events ClickHouse contains after dual-write + backfill, deduped by uuid. */
export function clickhouseContents(
  pg: StorableEvent[],
  dualWriteFrom: string,
  backfillUpTo: string,
): StorableEvent[] {
  const seen = new Set<string>();
  const ch: StorableEvent[] = [];
  for (const e of pg) {
    const capturedByDualWrite = e.ts >= dualWriteFrom;
    const capturedByBackfill = e.ts < backfillUpTo;
    if ((capturedByDualWrite || capturedByBackfill) && !seen.has(e.uuid)) {
      seen.add(e.uuid);
      ch.push(e);
    }
  }
  return ch;
}
