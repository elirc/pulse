/**
 * Graceful consumer shutdown (S15). A deploy replaces consumers; if a consumer is killed mid-batch, its
 * delivered-but-unacked entries sit in the pending list until another consumer claims them (the S04 crash-
 * recovery story — correct, but it costs a redelivery and a latency spike every single deploy). Graceful
 * shutdown makes the deploy clean: on SIGTERM we stop pulling NEW batches, finish and XACK the in-flight one,
 * deregister from the group, then exit. Systems that survive failure deploy for free — this is that same
 * pending-list discipline, now voluntary and orderly instead of forced by a crash.
 */
export type ShutdownState = "running" | "draining" | "stopped";

export class GracefulShutdown {
  private state: ShutdownState = "running";

  /** Signal handler calls this (SIGTERM/SIGINT). Idempotent; only running → draining. */
  requestDrain(): void {
    if (this.state === "running") this.state = "draining";
  }

  /** The loop checks this BEFORE pulling a new batch — false once draining, so the in-flight batch finishes. */
  shouldPullNewBatch(): boolean {
    return this.state === "running";
  }

  markStopped(): void {
    this.state = "stopped";
  }

  get current(): ShutdownState {
    return this.state;
  }
}

export interface ConsumerLoopResult {
  batches: number;
  processed: number;
}

/**
 * Run the consumer loop until drained. Each iteration: if we may pull a new batch, process one; otherwise stop.
 * The in-flight batch — the one already being processed when drain was requested — always completes, because the
 * drain check happens between batches, never mid-batch. After the loop, the caller deregisters and exits.
 */
export async function runConsumerLoop(
  processBatch: () => Promise<number>,
  shutdown: GracefulShutdown,
): Promise<ConsumerLoopResult> {
  let batches = 0;
  let processed = 0;
  while (shutdown.shouldPullNewBatch()) {
    const n = await processBatch();
    batches++;
    processed += n;
  }
  shutdown.markStopped();
  return { batches, processed };
}
