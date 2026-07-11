/**
 * A minimal event-stream port (S04) modeled on Redis Streams + consumer groups — which are, in turn, the same
 * concepts as a Kafka topic + consumer group (ADR-0005 maps them one-to-one). The abstraction exists so the
 * consumer's batching/dedupe/DLQ logic is testable against an in-memory fake with zero Redis, exactly as the
 * ingest and DB layers stay Postgres-free in CI. Production wires the Redis-backed implementation.
 *
 * Concept map (Streams ≈ Kafka):
 *   • add (XADD)                ≈ produce to a topic
 *   • consumer group            ≈ consumer group (each entry delivered to one member)
 *   • pending entries list (PEL)≈ delivered-but-not-committed offsets
 *   • ack (XACK)                ≈ commit offset
 *   • claim (XAUTOCLAIM)        ≈ partition reassignment / rebalance of stuck work
 */

/** One entry on the stream: a broker-assigned id plus the payload. */
export interface StreamEntry<T> {
  id: string;
  data: T;
}

/** The producer side: append and observe backlog (for backpressure). */
export interface StreamProducer<T> {
  add(data: T): Promise<string>;
  /** Unprocessed backlog: undelivered entries + delivered-but-unacked (PEL). Drives the backpressure watermark. */
  depth(): Promise<number>;
}

/** The consumer-group side. */
export interface StreamConsumer<T> {
  ensureGroup(group: string): Promise<void>;
  /** Deliver up to `count` NEW entries (Redis id ">"), moving them into the group's PEL. */
  readNew(group: string, count: number): Promise<StreamEntry<T>[]>;
  /** Re-read the group's PENDING entries (Redis id "0") — the crash-recovery / redelivery path. */
  readPending(group: string, count: number): Promise<StreamEntry<T>[]>;
  /** Commit: remove entries from the PEL so they are never redelivered. */
  ack(group: string, ids: string[]): Promise<void>;
  /** Size of the group's PEL (delivered, not yet acked). */
  pending(group: string): Promise<number>;
}

export type EventStream<T> = StreamProducer<T> & StreamConsumer<T>;
