/**
 * DLQ replay (S04). Once the cause of a poison batch is fixed (a validator bug, a bad producer), the
 * dead-lettered records are re-validated and the now-valid ones are pushed back onto the main stream to be
 * processed normally. Records that still fail are left for a human — replay is not a retry loop, it's a
 * deliberate re-submission after a fix.
 */
import { QueuedEventSchema } from "@pulse/shared";
import type { QueuedEvent } from "@pulse/shared";
import type { StreamProducer } from "@pulse/stream";
import type { DeadLetterRecord } from "./dlq";

export async function replayRecords(
  records: DeadLetterRecord[],
  mainStream: StreamProducer<QueuedEvent>,
): Promise<{ replayed: number; skipped: number }> {
  let replayed = 0;
  let skipped = 0;
  for (const record of records) {
    const parsed = QueuedEventSchema.safeParse(record.data);
    if (parsed.success) {
      await mainStream.add(parsed.data);
      replayed++;
    } else {
      skipped++; // still poison — the fix didn't cover this one
    }
  }
  return { replayed, skipped };
}
