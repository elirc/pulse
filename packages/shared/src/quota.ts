/**
 * Per-project event quotas (S15) — dogfood completo: Pulse meters itself with its own pipeline counts. A project
 * has a monthly event allowance; usage is metered from the ingest-ACCEPTED count and turns into three states:
 * ok, soft (a warning banner, still accepting), hard (429, shedding). Two design commitments:
 *   1. Meter from ACCEPTED (customer-visible 202s), never from STORED counts. Billing off post-loss storage
 *      counts is a conflict-of-interest bug class — a pipeline that drops events would under-bill and hide the
 *      loss. The number the customer sees us accept is the number we meter.
 *   2. Soft before hard. A cliff-edge cutoff at 100% surprises people; a soft banner at 80% is a warning they
 *      can act on, and the hard limit is the actual protection.
 */
export const SOFT_LIMIT_RATIO = 0.8;

export type QuotaState = "ok" | "soft" | "hard";

export interface QuotaAssessment {
  used: number;
  allowance: number;
  /** used / allowance (Infinity if allowance is 0). */
  ratio: number;
  state: QuotaState;
}

export function assessQuota(used: number, allowance: number, softRatio: number = SOFT_LIMIT_RATIO): QuotaAssessment {
  const ratio = allowance <= 0 ? Infinity : used / allowance;
  const state: QuotaState = ratio >= 1 ? "hard" : ratio >= softRatio ? "soft" : "ok";
  return { used, allowance, ratio, state };
}
