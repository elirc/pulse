/**
 * The consumer worker (S04). Reads the stream in batches via a consumer group, inserts them, and ACKs. The
 * order is the whole safety story: **insert first, ACK second.** If we crash between them, the entries stay in
 * the pending list and are redelivered — at-least-once delivery. (Redeliver-then-dedupe is how that becomes
 * effective exactly-once; the dedupe lands in a later commit.)
 *
 * `readNew` handles the steady state; `readPending` drains this consumer's un-acked backlog on startup — the
 * entries a previous crash left behind. Both go through the same insert→ack path.
 */
import type { QueuedEvent } from "@pulse/shared";
import type { EventStream } from "@pulse/stream";
import type { EventStore } from "./store";

export interface WorkerDeps {
  stream: EventStream<QueuedEvent>;
  store: EventStore;
  group: string;
  batchSize: number;
}

async function processBatch(deps: WorkerDeps, mode: "new" | "pending"): Promise<number> {
  const entries =
    mode === "new"
      ? await deps.stream.readNew(deps.group, deps.batchSize)
      : await deps.stream.readPending(deps.group, deps.batchSize);
  if (entries.length === 0) return 0;

  const events = entries.map((e) => e.data);
  await deps.store.insertBatch(events);
  await deps.stream.ack(
    deps.group,
    entries.map((e) => e.id),
  );
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
