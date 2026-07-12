/**
 * Event-loss accounting (S15) — the pipeline's double-entry bookkeeping and the course's conscience. An
 * analytics product that silently drops events is defective merchandise: "we think we got everything" is not a
 * number. So we reconcile two independently-counted totals — events ACCEPTED at ingest (the 202s we returned to
 * customers) versus events STORED in ClickHouse — for a window, and publish the difference as a loss ratio.
 * Target 0; alarmed above a tiny tolerance, because the acceptable loss for something a customer paid us to
 * record is approximately none.
 */
export const LOSS_ALARM_RATIO = 0.0001; // 0.01%

export interface LossReconciliation {
  windowStart: string;
  windowEnd: string;
  accepted: number;
  stored: number;
  /** accepted − stored. Negative means MORE stored than accepted — a duplicate/double-count bug, also alarming. */
  lost: number;
  lossRatio: number;
  alarm: boolean;
}

/** Reconcile accepted-vs-stored for a window into a loss ratio + alarm verdict. */
export function reconcileLoss(
  accepted: number,
  stored: number,
  windowStart: Date,
  windowEnd: Date,
  alarmRatio: number = LOSS_ALARM_RATIO,
): LossReconciliation {
  const lost = accepted - stored;
  const lossRatio = accepted === 0 ? 0 : lost / accepted;
  // Alarm on loss OR on over-count (negative lost): both mean the ledger doesn't balance.
  const alarm = Math.abs(lossRatio) > alarmRatio;
  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    accepted,
    stored,
    lost,
    lossRatio,
    alarm,
  };
}
