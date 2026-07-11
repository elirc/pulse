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

export interface EventStore {
  insertBatch(events: QueuedEvent[]): Promise<number>;
}

export class PrismaEventStore implements EventStore {
  async insertBatch(events: QueuedEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    const result = await prisma.event.createMany({
      data: events.map((e) => ({
        uuid: e.uuid,
        projectId: e.projectId,
        distinctId: e.distinctId,
        name: e.name,
        props: e.props as object,
        ts: new Date(e.ts),
        ingestedAt: new Date(e.ingestedAt),
      })),
    });
    return result.count;
  }
}

/** In-memory store for tests — keeps every inserted event so a test can count duplicates. */
export class InMemoryEventStore implements EventStore {
  public readonly events: QueuedEvent[] = [];
  insertBatch(events: QueuedEvent[]): Promise<number> {
    this.events.push(...events);
    return Promise.resolve(events.length);
  }
}
