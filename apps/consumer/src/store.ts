/**
 * The event store (S04): where the consumer durably writes events. Batched, because one multi-row INSERT per
 * N events is far cheaper than N single inserts — the whole reason a consumer can keep up with a firehose the
 * synchronous hot path couldn't.
 *
 * `insertBatch` returns how many rows were actually written. That return value carries the dedup story: once a
 * unique index on `uuid` lands (S04 dedup commit), a re-delivered batch inserts fewer rows than it contains,
 * and the difference is exactly the duplicates at-least-once delivery handed us.
 *
 * Tests inject InMemoryEventStore; production uses PrismaEventStore. Neither touches Redis; CI touches neither.
 */
import { prisma } from "@pulse/db";
import type { QueuedEvent } from "@pulse/shared";

/** A QueuedEvent with its resolved person (S06) — what actually gets stored. */
export interface StorableEvent extends QueuedEvent {
  personId: string;
}

export interface EventStore {
  insertBatch(events: StorableEvent[]): Promise<number>;
}

export class PrismaEventStore implements EventStore {
  // Batch size is a throughput/latency dial: a bigger multi-row INSERT amortizes round-trips and index work
  // (higher throughput) but holds a longer transaction and raises tail latency + memory. The BATCH_SIZE env
  // (default 200) is the knob; the PR body reports the throughput at a couple of settings. createMany issues a
  // single multi-row INSERT — the point of this stage over N single inserts.
  async insertBatch(events: StorableEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    const result = await prisma.event.createMany({
      data: events.map((e) => ({
        uuid: e.uuid,
        projectId: e.projectId,
        distinctId: e.distinctId,
        personId: e.personId,
        name: e.name,
        props: e.props as object,
        ts: new Date(e.ts),
        ingestedAt: new Date(e.ingestedAt),
      })),
      // ON CONFLICT DO NOTHING on the unique uuid — a redelivered event inserts nothing. This is the "apply"
      // half of "at-least-once delivery + idempotent apply = effective exactly-once". count = rows actually
      // inserted, so (batch length − count) is exactly how many duplicates delivery handed us this round.
      skipDuplicates: true,
    });
    return result.count;
  }
}

/** In-memory store for tests — mirrors the unique-uuid constraint (dedupes on uuid) and records each batch's
 *  attempted size so a test can prove both multi-row batching and idempotent apply. */
export class InMemoryEventStore implements EventStore {
  public readonly events: StorableEvent[] = [];
  public readonly batches: number[] = [];
  private readonly seen = new Set<string>();
  insertBatch(events: StorableEvent[]): Promise<number> {
    this.batches.push(events.length);
    let inserted = 0;
    for (const e of events) {
      if (this.seen.has(e.uuid)) continue; // ON CONFLICT DO NOTHING (unique uuid)
      this.seen.add(e.uuid);
      this.events.push(e);
      inserted++;
    }
    return Promise.resolve(inserted);
  }
}
