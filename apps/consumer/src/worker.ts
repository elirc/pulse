/**
 * The consumer worker (S04). Reads the stream in batches via a consumer group, inserts them, and ACKs. The
 * order is the whole safety story: **insert first, ACK second.** If we crash between them, the entries stay in
 * the pending list and are redelivered — at-least-once delivery. (Redeliver-then-dedupe is how that becomes
 * effective exactly-once; the dedupe lands in a later commit.)
 *
 * `readNew` handles the steady state; `readPending` drains this consumer's un-acked backlog on startup — the
 * entries a previous crash left behind. Both go through the same insert→ack path.
 */
import { QueuedEventSchema, type QueuedEvent } from "@pulse/shared";
import type { EventStream } from "@pulse/stream";
import { enrich } from "./enrich";
import type { EventStore, StorableEvent } from "./store";
import type { DeadLetterQueue } from "./dlq";
import type { IdentityResolver } from "./identity";

export interface WorkerDeps {
  stream: EventStream<QueuedEvent>;
  store: EventStore;
  dlq: DeadLetterQueue;
  resolver: IdentityResolver;
  group: string;
  batchSize: number;
}

/** Narrow an unknown props value to a plain record (property directives), or undefined. */
function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

async function processBatch(deps: WorkerDeps, mode: "new" | "pending"): Promise<number> {
  const entries =
    mode === "new"
      ? await deps.stream.readNew(deps.group, deps.batchSize)
      : await deps.stream.readPending(deps.group, deps.batchSize);
  if (entries.length === 0) return 0;

  // Validate → resolve person (write-path identity) → enrich → batch insert. A poison entry (fails the shape
  // check) is dead-lettered and acked, so it can never wedge the group behind it.
  const good: StorableEvent[] = [];
  const ackIds: string[] = [];
  for (const entry of entries) {
    const parsed = QueuedEventSchema.safeParse(entry.data);
    if (!parsed.success) {
      await deps.dlq.deadLetter(entry.data, parsed.error.message);
      ackIds.push(entry.id); // poison is durably in the DLQ now — ack so it isn't redelivered
      continue;
    }
    const enriched = enrich(parsed.data);
    // An $identify event carries the previous anonymous id in props; merge before resolving so the event (and
    // all future ones for either id) resolves to the surviving person.
    if (enriched.name === "$identify" && typeof enriched.props.$anon_distinct_id === "string") {
      await deps.resolver.identify(enriched.projectId, enriched.props.$anon_distinct_id, enriched.distinctId);
    }
    const personId = await deps.resolver.resolve(enriched.projectId, enriched.distinctId);
    // Apply person-property directives ($set / $set_once) carried on the event.
    const set = asRecord(enriched.props.$set);
    const setOnce = asRecord(enriched.props.$set_once);
    if (set || setOnce) await deps.resolver.setProperties(personId, set ?? {}, setOnce ?? {});
    good.push({ ...enriched, personId });
    ackIds.push(entry.id);
  }
  if (good.length > 0) await deps.store.insertBatch(good);
  await deps.stream.ack(deps.group, ackIds);
  return entries.length;
}

/** Process one batch of NEW entries. Returns the number processed (0 when the stream is drained). */
export function processNewBatch(deps: WorkerDeps): Promise<number> {
  return processBatch(deps, "new");
}

/** Drain the consumer's PENDING (un-acked) backlog — the crash-recovery path, run on startup. */
export function processPendingBatch(deps: WorkerDeps): Promise<number> {
  return processBatch(deps, "pending");
}

/** Run the consumer loop until the stream is idle, then stop (a real deployment loops forever with a poll). */
export async function drain(deps: WorkerDeps): Promise<number> {
  await deps.stream.ensureGroup(deps.group);
  let total = 0;
  // Recover anything a previous instance left un-acked, then process new work.
  for (;;) {
    const n = await processPendingBatch(deps);
    if (n === 0) break;
    total += n;
  }
  for (;;) {
    const n = await processNewBatch(deps);
    if (n === 0) break;
    total += n;
  }
  return total;
}
