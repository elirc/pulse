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

import type { FlatRow } from "./pivot";

export interface SampledRow {
  bucket: string;
  label: string | null;
  /** The scaled estimate (observed / sampleRate). */
  value: number;
  ci95: number;
  reliable: boolean;
}

export interface SampledSummary {
  rows: SampledRow[];
  /** False when the TOTAL observed across the result is too thin — the caller should un-sample and run exact. */
  reliable: boolean;
}

/**
 * Turn raw sampled rows into estimates with CIs, and decide — at the whole-query level — whether the sample was
 * thick enough to trust. A breakdown can have many small series; judging each in isolation would un-sample a
 * chart just because one label is rare. We gate on the TOTAL observed instead: if the whole result is thin, the
 * caller re-runs the query exact.
 */
export function summarizeSampled(rows: FlatRow[], sampleRate: number): SampledSummary {
  const out: SampledRow[] = rows.map((r) => {
    const e = estimateFromSample(r.value, sampleRate);
    return { bucket: r.bucket, label: r.label, value: e.estimate, ci95: e.ci95, reliable: e.reliable };
  });
  const totalObserved = rows.reduce((s, r) => s + r.value, 0);
  return { rows: out, reliable: totalObserved >= MIN_RELIABLE_OBSERVED };
}
