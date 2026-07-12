/**
 * The columnar events store (S07) — the ClickHouse write path. Two ideas shape it:
 *
 * 1. BIGGER inserts are better, to a point. ClickHouse creates a "part" per insert and merges parts in the
 *    background; many tiny inserts make many tiny parts and drown it in merges. So the consumer BUFFERS several
 *    stream batches into one larger CH insert (an insert window) — the opposite of the row-store instinct to
 *    write small and often.
 * 2. Inserts are async and fire-and-forget-ish: we don't block the consumer on each flush; we flush on size or
 *    time. (The insert-window dedupe set lands in the next commit.)
 *
 * The port keeps CI ClickHouse-free: InMemoryColumnStore for tests, ClickHouseColumnStore (structural client)
 * for prod.
 */
import type { StorableEvent } from "./store";

export interface ColumnStore {
  insert(events: StorableEvent[]): Promise<void>;
}

/** In-memory columnar store for tests. `rows` are the raw inserts; `deduped()` models what a ReplacingMergeTree
 *  merge (or a `FINAL` query) would return: one row per uuid, the one with the latest ingestedAt. */
export class InMemoryColumnStore implements ColumnStore {
  public readonly rows: StorableEvent[] = [];
  insert(events: StorableEvent[]): Promise<void> {
    this.rows.push(...events);
    return Promise.resolve();
  }

  /** ReplacingMergeTree semantics: collapse rows sharing a uuid, keeping the max ingestedAt. */
  deduped(): StorableEvent[] {
    const byUuid = new Map<string, StorableEvent>();
    for (const row of this.rows) {
      const existing = byUuid.get(row.uuid);
      if (!existing || row.ingestedAt > existing.ingestedAt) byUuid.set(row.uuid, row);
    }
    return [...byUuid.values()];
  }
}

/** The subset of a ClickHouse client this adapter uses. `@clickhouse/client` satisfies it. */
export interface ClickHouseLike {
  insert(params: { table: string; values: unknown[]; format: "JSONEachRow" }): Promise<unknown>;
}

/** Map an event to a ClickHouse row: props is serialized JSON; times are ISO the server parses to DateTime64. */
function toRow(e: StorableEvent): Record<string, unknown> {
  return {
    uuid: e.uuid,
    projectId: e.projectId,
    distinctId: e.distinctId,
    personId: e.personId,
    name: e.name,
    props: JSON.stringify(e.props),
    ts: e.ts,
    ingestedAt: e.ingestedAt,
  };
}

export class ClickHouseColumnStore implements ColumnStore {
  constructor(
    private readonly ch: ClickHouseLike,
    private readonly table = "events",
  ) {}
  async insert(events: StorableEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.ch.insert({ table: this.table, values: events.map(toRow), format: "JSONEachRow" });
  }
}

export interface BufferOptions {
  /** Flush when the buffer reaches this many rows. Big, for columnar. Default 10_000. */
  maxRows?: number;
  /** How many recent uuids to remember for insert-window dedupe. Default 100_000. */
  dedupeWindow?: number;
}

/**
 * Buffers rows across stream batches and flushes to the underlying ColumnStore in larger inserts, with an
 * insert-window dedupe set on top.
 *
 * Dedupe here is the S04 problem with new physics (S07). ClickHouse has no unique index, so redeliveries can't
 * be rejected at write. ReplacingMergeTree collapses them EVENTUALLY (at merge), but a query before the merge
 * could double-count — and `FINAL` (force the merge per query) is too expensive to run always. So we catch the
 * COMMON case — a redelivery arriving close behind the original — with a bounded in-memory set of recently-seen
 * uuids, and let ReplacingMergeTree mop up the rare straggler. Same lesson as S04 (at-least-once needs
 * idempotent apply); different implementation, because the tool the PG version used doesn't exist here.
 */
export class BufferedColumnStore implements ColumnStore {
  private buffer: StorableEvent[] = [];
  private readonly maxRows: number;
  private readonly dedupeWindow: number;
  private readonly seen = new Map<string, true>(); // insertion-ordered → oldest evicted first

  constructor(
    private readonly inner: ColumnStore,
    opts: BufferOptions = {},
  ) {
    this.maxRows = opts.maxRows ?? 10_000;
    this.dedupeWindow = opts.dedupeWindow ?? 100_000;
  }

  private isFreshUuid(uuid: string): boolean {
    if (this.seen.has(uuid)) return false;
    this.seen.set(uuid, true);
    if (this.seen.size > this.dedupeWindow) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  async insert(events: StorableEvent[]): Promise<void> {
    for (const e of events) if (this.isFreshUuid(e.uuid)) this.buffer.push(e); // insert-window dedupe
    if (this.buffer.length >= this.maxRows) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    await this.inner.insert(batch);
  }

  pending(): number {
    return this.buffer.length;
  }
}
