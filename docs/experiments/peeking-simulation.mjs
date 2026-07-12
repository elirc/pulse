/**
 * A/A peeking simulation (S14) — the number that teaches. Run 1000 A/A experiments (both arms drawn from the
 * SAME conversion rate, so the TRUE lift is zero). Under two analysis policies:
 *   • PEEKING: check significance after every batch of new samples and STOP the first time p < 0.05.
 *   • FIXED HORIZON: look exactly once, at a pre-registered sample size.
 * The false-positive rate should be ~5% by construction (α = 0.05). Peeking inflates it dramatically — that
 * inflation is the whole argument for a fixed horizon.
 *
 * Run: `node docs/experiments/peeking-simulation.mjs`
 */

function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

function pValue(c1, n1, c2, n2) {
  if (n1 === 0 || n2 === 0) return 1;
  const pooled = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = (c2 / n2 - c1 / n1) / se;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

// A tiny seeded PRNG so the teaching number is reproducible.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const RATE = 0.1; // both arms convert at 10% — TRUE lift is zero (A/A)
const N_FINAL = 2000; // per arm
const PEEK_EVERY = 100;
const EXPERIMENTS = 1000;
const rnd = lcg(20260711);

let peekingFalsePositives = 0;
let fixedFalsePositives = 0;

for (let e = 0; e < EXPERIMENTS; e++) {
  let cA = 0;
  let cB = 0;
  let peekerWouldStop = false; // any interim peek crossed p<0.05 (a peeker declares a winner)
  // Always run the SAME sequence to the full horizon, so both policies are judged on identical data.
  for (let n = 1; n <= N_FINAL; n++) {
    if (rnd() < RATE) cA++;
    if (rnd() < RATE) cB++;
    if (!peekerWouldStop && n % PEEK_EVERY === 0 && pValue(cA, n, cB, n) < 0.05) {
      peekerWouldStop = true; // record it, but keep collecting so the fixed-horizon judge sees full data
    }
  }
  if (peekerWouldStop) peekingFalsePositives++;
  if (pValue(cA, N_FINAL, cB, N_FINAL) < 0.05) fixedFalsePositives++; // one look, at the horizon
}

const pct = (x) => `${((x / EXPERIMENTS) * 100).toFixed(1)}%`;
console.log(`A/A experiments: ${EXPERIMENTS}, per-arm horizon: ${N_FINAL}, peek every: ${PEEK_EVERY}`);
console.log(`PEEKING false-positive rate:      ${pct(peekingFalsePositives)}  (should be ~5%, isn't)`);
console.log(`FIXED-HORIZON false-positive rate: ${pct(fixedFalsePositives)}  (~5%, as designed)`);
