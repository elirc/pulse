/**
 * Query sampling (S12). For interactive exploration, running a query over a 10% SAMPLE is ~10× cheaper — but the
 * number you get back is an ESTIMATE, and rendering it as if it were exact is a lie. This computes the estimate
 * and its 95% confidence interval so the UI can show "~12,400 ±3%" honestly.
 *
 * The math, for a count observed in a p-fraction sample: the true count ≈ observed / p, and the estimator's
 * standard error ≈ sqrt(observed·(1−p)) / p (Poisson/binomial approximation). The 95% CI is ±1.96·SE. Where it
 * BREAKS: for small observed counts (rare events, tiny samples) the normal approximation is invalid and the
 * interval is meaningless — so we flag `reliable: false` below the threshold, and the caller un-samples those.
 */
export const MIN_RELIABLE_OBSERVED = 30;
const Z95 = 1.96;

export interface SampleEstimate {
  estimate: number;
  /** ±absolute at 95% confidence. */
  ci95: number;
  /** ±relative (ci95 / estimate), 0..1. */
  relativeCi: number;
  /** False when `observed` is too small for the normal approximation — un-sample instead. */
  reliable: boolean;
}

export function estimateFromSample(observed: number, sampleRate: number): SampleEstimate {
  const estimate = Math.round(observed / sampleRate);
  const se = Math.sqrt(observed * (1 - sampleRate)) / sampleRate;
  const ci95 = Z95 * se;
  const relativeCi = estimate === 0 ? 0 : ci95 / estimate;
  return {
    estimate,
    ci95: Math.round(ci95),
    relativeCi,
    reliable: observed >= MIN_RELIABLE_OBSERVED,
  };
}

/** Format an estimate for display: "~12,400 ±3%". */
export function formatEstimate(e: SampleEstimate): string {
  return `~${e.estimate.toLocaleString()} ±${Math.round(e.relativeCi * 100)}%`;
}
