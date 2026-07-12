/**
 * Hourly event-loss reconciliation job (S15). Independently counts events ACCEPTED at ingest and events STORED
 * in ClickHouse for the last window, and publishes the loss ratio (target 0, alarmed above 0.01%). Pure over
 * ports — the count sources and the metric sink are injected — so it runs in CI without Redis or ClickHouse.
 *
 * The two counts MUST come from independent sources: accepted from ingest's own counter (what we told customers
 * we took), stored from a `SELECT count()` in CH (what actually landed). Counting both from the same place would
 * make the check tautological — the whole value is that they're measured separately and must agree.
 */
import { reconcileLoss, type LossReconciliation } from "@pulse/shared";

export interface LossReconcilePorts {
  /** Events accepted (202'd) at ingest in [start, end). */
  acceptedCount(start: Date, end: Date): Promise<number>;
  /** Events stored in ClickHouse whose ingestedAt is in [start, end). */
  storedCount(start: Date, end: Date): Promise<number>;
  /** Publish the reconciliation (a metric + an alarm if it doesn't balance). */
  publish(rec: LossReconciliation): Promise<void>;
}

export async function runLossReconciliation(
  ports: LossReconcilePorts,
  now: Date = new Date(),
  windowMs = 60 * 60 * 1000,
): Promise<LossReconciliation> {
  const end = now;
  const start = new Date(now.getTime() - windowMs);
  const [accepted, stored] = await Promise.all([ports.acceptedCount(start, end), ports.storedCount(start, end)]);
  const rec = reconcileLoss(accepted, stored, start, end);
  await ports.publish(rec);
  return rec;
}
