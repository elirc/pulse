/**
 * Backfill (S07, Act 3): copy the Postgres event history into ClickHouse in chunks. Three properties make a
 * backfill safe to run against a live system:
 *   • RESUMABLE — it walks a keyset cursor (ts, uuid), so a crash resumes from the last checkpoint instead of
 *     restarting a multi-hour copy.
 *   • IDEMPOTENT — re-running (from a checkpoint, or the overlap window in the reconciliation fix) re-inserts
 *     rows, and ClickHouse's uuid dedupe absorbs them. The S03 client-minted uuid earns its keep a THIRD time.
 *   • CHUNKED — partition-sized batches, not one giant query that OOMs or holds a transaction for an hour.
 *
 * Source is a port so tests run without Postgres.
 */
import type { StorableEvent } from "./store";
import type { ColumnStore } from "./columnstore";

export interface Cursor {
  ts: string;
  uuid: string;
}

export interface BackfillSource {
  /** Read up to `limit` events after `cursor` (keyset order ts, uuid). Empty array = done. */
  readChunk(cursor: Cursor | null, limit: number): Promise<StorableEvent[]>;
}

export interface BackfillOptions {
  chunkSize?: number;
  startCursor?: Cursor | null;
  /** Called after each chunk with the new checkpoint — persist it to make the backfill resumable. */
  onProgress?: (cursor: Cursor, total: number) => void;
}

function cursorOf(e: StorableEvent): Cursor {
  return { ts: e.ts, uuid: e.uuid };
}

export async function backfill(
  source: BackfillSource,
  target: ColumnStore,
  opts: BackfillOptions = {},
): Promise<number> {
  const chunkSize = opts.chunkSize ?? 50_000;
  let cursor = opts.startCursor ?? null;
  let total = 0;
  for (;;) {
    const chunk = await source.readChunk(cursor, chunkSize);
    if (chunk.length === 0) break;
    await target.insert(chunk);
    cursor = cursorOf(chunk[chunk.length - 1]);
    total += chunk.length;
    opts.onProgress?.(cursor, total);
  }
  return total;
}

/** In-memory source for tests: events sorted by (ts, uuid), read by keyset cursor. */
export class InMemoryBackfillSource implements BackfillSource {
  private readonly sorted: StorableEvent[];
  constructor(events: StorableEvent[]) {
    this.sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts) || a.uuid.localeCompare(b.uuid));
  }
  readChunk(cursor: Cursor | null, limit: number): Promise<StorableEvent[]> {
    const start = cursor
      ? this.sorted.findIndex((e) => e.ts > cursor.ts || (e.ts === cursor.ts && e.uuid > cursor.uuid))
      : 0;
    if (start < 0) return Promise.resolve([]);
    return Promise.resolve(this.sorted.slice(start, start + limit));
  }
}
