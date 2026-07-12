/**
 * Cardinality guard (S12). A breakdown by a high-cardinality property (`$url`, `session_id`, anything user-set
 * and unbounded) would return thousands of series — useless as a chart, expensive to compute and ship. S05
 * added top-N + Other to trends; this generalizes it to a hard GUARD applied everywhere: if a breakdown
 * property's distinct count (from the S12 cardinality tracker) exceeds the threshold, we FORCE a small top-N and
 * tell the analyst why. 'Other' isn't a hack here — it's the honest representation of a long tail, made
 * mandatory.
 */
export const HIGH_CARDINALITY_THRESHOLD = 10_000;
export const GUARDED_TOP_N = 20;

export interface CardinalityGuardResult {
  effectiveTopN: number;
  guarded: boolean;
  notice?: string;
}

export function cardinalityGuard(
  property: string,
  distinctCount: number,
  requestedTopN: number,
  threshold = HIGH_CARDINALITY_THRESHOLD,
): CardinalityGuardResult {
  if (distinctCount > threshold) {
    const effectiveTopN = Math.min(requestedTopN, GUARDED_TOP_N);
    return {
      effectiveTopN,
      guarded: true,
      notice: `"${property}" has ~${distinctCount.toLocaleString()} distinct values — showing the top ${effectiveTopN} and folding the rest into "Other".`,
    };
  }
  return { effectiveTopN: requestedTopN, guarded: false };
}
