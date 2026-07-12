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

/** In-memory columnar store for tests: keeps every inserted row (dedupe modeling arrives with dedupe v2). */
export class InMemoryColumnStore implements ColumnStore {
  public readonly rows: StorableEvent[] = [];
  insert(events: StorableEvent[]): Promise<void> {
    this.rows.push(...events);
    return Promise.resolve();
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
}

/**
 * Buffers rows across stream batches and flushes to the underlying ColumnStore in larger inserts. Wraps any
 * ColumnStore. `flush()` is called on size here and should be called on a timer + on shutdown by the owner.
 */
export class BufferedColumnStore implements ColumnStore {
  private buffer: StorableEvent[] = [];
  private readonly maxRows: number;
  constructor(
    private readonly inner: ColumnStore,
    opts: BufferOptions = {},
  ) {
    this.maxRows = opts.maxRows ?? 10_000;
  }

  async insert(events: StorableEvent[]): Promise<void> {
    this.buffer.push(...events);
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
