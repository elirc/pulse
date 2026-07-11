/**
 * In-memory EventStream (S04) — a faithful-enough model of Redis Streams consumer-group semantics for tests and
 * local dev. It reproduces the ONE behavior the whole sprint turns on: an entry delivered to a group but not
 * acked stays in the pending list and is redelivered later. That redelivery is where duplicates are born, which
 * is why "at-least-once + idempotent apply = effective exactly-once" is the discipline the consumer must earn.
 */
import type { EventStream, StreamEntry } from "./types";

interface GroupState {
  /** Index into the log of the next NEW entry to deliver. */
  cursor: number;
  /** Delivered-but-unacked entries, by id (the PEL). */
  pending: Map<string, StreamEntry<unknown>>;
}

export class InMemoryEventStream<T> implements EventStream<T> {
  private readonly log: StreamEntry<T>[] = [];
  private seq = 0;
  private readonly groups = new Map<string, GroupState>();

  add(data: T): Promise<string> {
    const id = `${++this.seq}-0`;
    this.log.push({ id, data });
    return Promise.resolve(id);
  }

  depth(): Promise<number> {
    // Backlog = entries not yet acked by ANY group. With a single group (our case) this is undelivered + PEL.
    let maxUnprocessed = this.log.length; // if no group has consumed, the whole log is backlog
    for (const g of this.groups.values()) {
      const undelivered = this.log.length - g.cursor;
      maxUnprocessed = Math.min(maxUnprocessed, undelivered + g.pending.size);
    }
    return Promise.resolve(this.groups.size === 0 ? this.log.length : maxUnprocessed);
  }

  ensureGroup(group: string): Promise<void> {
    if (!this.groups.has(group)) this.groups.set(group, { cursor: 0, pending: new Map() });
    return Promise.resolve();
  }

  private group(name: string): GroupState {
    const g = this.groups.get(name);
    if (!g) throw new Error(`unknown group: ${name} (call ensureGroup first)`);
    return g;
  }

  readNew(group: string, count: number): Promise<StreamEntry<T>[]> {
    const g = this.group(group);
    const batch = this.log.slice(g.cursor, g.cursor + count);
    g.cursor += batch.length;
    for (const entry of batch) g.pending.set(entry.id, entry);
    return Promise.resolve(batch);
  }

  readPending(group: string, count: number): Promise<StreamEntry<T>[]> {
    const g = this.group(group);
    const entries = [...g.pending.values()].slice(0, count) as StreamEntry<T>[];
    return Promise.resolve(entries);
  }

  ack(group: string, ids: string[]): Promise<void> {
    const g = this.group(group);
    for (const id of ids) g.pending.delete(id);
    return Promise.resolve();
  }

  pending(group: string): Promise<number> {
    return Promise.resolve(this.group(group).pending.size);
  }
}
