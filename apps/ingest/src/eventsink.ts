/**
 * The event sink (S02) — the seam between "we accepted an event" and "we durably stored it". Today it is a
 * synchronous Postgres insert (the honest baseline). Naming it as a port now is deliberate: in S04 the sink
 * becomes a Redis Streams producer (the hot path stops waiting on storage), and in S07 the thing behind it
 * migrates from Postgres to ClickHouse. `POST /e` will not change across any of that — only the sink will.
 *
 * It is also the injection seam that lets CI exercise the full ingest path with an in-memory sink, no DB.
 */
import { prisma } from "@pulse/db";

export interface IngestEvent {
  projectId: string;
  distinctId: string;
  name: string;
  props: Record<string, unknown>;
  ts: Date;
}

export interface EventSink {
  append(event: IngestEvent): Promise<void>;
}

/** Production sink: a synchronous insert into the naive Postgres events table. */
export class PrismaEventSink implements EventSink {
  async append(event: IngestEvent): Promise<void> {
    await prisma.event.create({
      data: {
        projectId: event.projectId,
        distinctId: event.distinctId,
        name: event.name,
        props: event.props as object,
        ts: event.ts,
      },
    });
  }
}

/** Test/dev sink: keep events in memory so the pipeline is exercisable without a database. */
export class InMemoryEventSink implements EventSink {
  public readonly events: IngestEvent[] = [];
  append(event: IngestEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}
