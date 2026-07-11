/**
 * Dead-letter queue (S04). A poison event — one that will never process (corrupt/foreign stream entry, a shape
 * the consumer can't parse) — must not wedge the whole consumer group behind it. So instead of retrying it
 * forever (blocking every event behind it) or dropping it silently (losing the evidence), we route it to a
 * dead-letter stream WITH error context and ack the original. The DLQ is a bug-report queue: it's data about
 * your validators. Fix the cause, then replay (see replay.ts).
 */
import type { StreamProducer } from "@pulse/stream";

export interface DeadLetterRecord {
  data: unknown;
  error: string;
  failedAt: string;
}

export interface DeadLetterQueue {
  deadLetter(data: unknown, error: string): Promise<void>;
}

/** Redis-backed DLQ: XADD the raw payload + error context to a separate dead-letter stream. */
export class StreamDeadLetterQueue implements DeadLetterQueue {
  constructor(private readonly dlq: StreamProducer<DeadLetterRecord>) {}
  async deadLetter(data: unknown, error: string): Promise<void> {
    await this.dlq.add({ data, error, failedAt: new Date().toISOString() });
  }
}

/** In-memory DLQ for tests — records what was dead-lettered so a test can assert the poison was isolated. */
export class InMemoryDeadLetterQueue implements DeadLetterQueue {
  public readonly records: DeadLetterRecord[] = [];
  deadLetter(data: unknown, error: string): Promise<void> {
    this.records.push({ data, error, failedAt: new Date().toISOString() });
    return Promise.resolve();
  }
}
