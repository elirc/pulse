/**
 * Experiment results (S14) — the significance math, as ~40 lines of code you own, with its assumptions stated.
 * Conversion per variant comes from exposure→goal (the SDK's $flag_evaluated is step 1, the goal event step 2 —
 * the S08 funnel engine, reused). The comparison is a two-proportion z-test with a confidence interval on the
 * lift. Assumptions, listed because statistics you can't state you shouldn't ship: (1) independent observations,
 * (2) fixed sample size decided UP FRONT (peeking invalidates the p-value — see the S14 peeking doc), (3) the
 * normal approximation, valid when np and n(1-p) are both ≳ 10.
 */
export interface VariantCount {
  variant: string;
  exposed: number;
  converted: number;
}

export interface VariantResult extends VariantCount {
  rate: number;
}

export type Significance = "significant" | "no_effect_detected" | "collecting";

export interface ExperimentResult {
  variants: VariantResult[];
  /** Control is the first variant; `test` is the second. */
  control: string;
  test: string;
  /** Relative lift of test vs control: (testRate − controlRate) / controlRate. */
  lift: number;
  liftCiLow: number;
  liftCiHigh: number;
  zScore: number;
  pValue: number;
  significant: boolean;
}

const Z95 = 1.959964; // two-sided 95%

/** Standard normal CDF via the Abramowitz-Stegun erf approximation (|error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Two-proportion z-test (pooled variance). Returns the z score and the two-sided p-value. */
export function twoProportionZTest(c1: number, n1: number, c2: number, n2: number): { z: number; pValue: number } {
  if (n1 === 0 || n2 === 0) return { z: 0, pValue: 1 };
  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pooled = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, pValue: 1 };
  const z = (p2 - p1) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { z, pValue };
}

/**
 * Compute the full result. Control = variants[0], test = variants[1]. The lift CI uses the UNPOOLED SE (each
 * proportion's own variance) because it describes the estimated difference, whereas the z-test pools under the
 * null. `collecting` is reported by the UI via required-n, not decided here.
 */
export function computeExperimentResult(counts: VariantCount[], alpha = 0.05): ExperimentResult {
  const variants: VariantResult[] = counts.map((c) => ({ ...c, rate: c.exposed === 0 ? 0 : c.converted / c.exposed }));
  const control = variants[0];
  const test = variants[1] ?? variants[0];

  const { z, pValue } = twoProportionZTest(control.converted, control.exposed, test.converted, test.exposed);
  const diff = test.rate - control.rate;
  const seUnpooled = Math.sqrt(
    (control.exposed === 0 ? 0 : (control.rate * (1 - control.rate)) / control.exposed) +
      (test.exposed === 0 ? 0 : (test.rate * (1 - test.rate)) / test.exposed),
  );
  const diffLow = diff - Z95 * seUnpooled;
  const diffHigh = diff + Z95 * seUnpooled;
  const asLift = (d: number): number => (control.rate === 0 ? 0 : d / control.rate);

  return {
    variants,
    control: control.variant,
    test: test.variant,
    lift: asLift(diff),
    liftCiLow: asLift(diffLow),
    liftCiHigh: asLift(diffHigh),
    zScore: z,
    pValue,
    significant: pValue < alpha,
  };
}

/**
 * Required sample size PER VARIANT for a two-proportion test (S14) — the number the UI shows progress toward, so
 * an analyst watches a progress bar instead of a p-value while collecting. Standard formula for baseline rate
 * `p`, minimum detectable effect `mde` (relative), 95%/80% defaults.
 */
export function requiredSampleSizePerVariant(baselineRate: number, mde: number, alpha = 0.05, power = 0.8): number {
  const p1 = baselineRate;
  const p2 = baselineRate * (1 + mde);
  if (p1 <= 0 || p1 >= 1 || p2 <= 0 || p2 >= 1) return Infinity;
  const zAlpha = zForTwoSided(alpha);
  const zBeta = zForOneSided(1 - power);
  const pBar = (p1 + p2) / 2;
  const numerator = zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil(numerator ** 2 / (p2 - p1) ** 2);
}

/** Inverse normal for common tail probabilities via a small rational approximation (good enough for z_α/z_β). */
function zForTwoSided(alpha: number): number {
  return invNorm(1 - alpha / 2);
}
function zForOneSided(tail: number): number {
  return invNorm(1 - tail);
}
function invNorm(p: number): number {
  // Beasley-Springer/Moro approximation.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
