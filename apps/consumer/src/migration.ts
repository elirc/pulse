/**
 * Migration boundary planning (S07, Act 3). ClickHouse ends up with the union of what dual-write captured
 * (events at ts >= dualWriteFrom) and what backfill copied (events at ts < backfillUpTo). Where those two
 * boundaries meet is the whole game: leave a gap and CH silently loses events; overlap and dedupe absorbs it.
 */
import type { StorableEvent } from "./store";

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Where should backfill stop? BUGGY VERSION: at the backfill's own snapshot time. But the snapshot was taken
 * before dual-write actually engaged (deploy lag), so events written to PG in [snapshot, dualWriteFrom) are in
 * neither the backfill nor the shadow — a gap. (Fixed in the next commit.)
 */
export function planBackfillUpTo(backfillSnapshot: string, _dualWriteFrom: string): string {
  return backfillSnapshot;
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
