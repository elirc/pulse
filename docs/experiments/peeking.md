# The peeking problem — why "check daily, stop at p<0.05" lies to you

The single most common way to run a bad experiment is to watch it live and stop the moment it crosses
significance. It feels responsible — you're paying attention! — and it inflates your false-positive rate far
past the 5% you think you're getting. This is the **peeking problem**, and the number that proves it is a
simulation, not an argument.

## The simulation (run it yourself)
```bash
node docs/experiments/peeking-simulation.mjs
```
It runs **1000 A/A experiments** — both arms drawn from the *same* 10% conversion rate, so the true lift is
**zero**. Any "significant" result is a false positive by construction. Two analysis policies, same data:

| Policy | What it does | False-positive rate |
|---|---|---|
| **Peeking** | check p after every 100 samples, stop the first time p < 0.05 | **~26%** |
| **Fixed horizon** | look exactly once, at the pre-registered sample size | **~4.7%** (≈ the 5% α, as designed) |

Roughly **one in four** null experiments is declared a winner under peeking. The A/A test can't be wrong about
the truth — the lift is zero — so a 26% "win" rate is 26% pure false positive.

## Why it happens
A p-value is calibrated for **one** look. Each interim look is another chance for random noise to wander across
the p < 0.05 line; with enough looks, a null experiment almost certainly crosses it *at some point*, and a peeker
stops exactly there — at the random high-water mark. You're not detecting an effect; you're sampling the maximum
of a random walk and calling it signal.

## Pulse's policy: fixed horizon, enforced by the UI
- **Decide the required sample size up front** (`requiredSampleSizePerVariant`, from baseline rate + minimum
  detectable effect). This is a pre-registration.
- **The results UI hides the verdict while collecting** and shows a *progress bar toward n* instead of a live
  p-value — you can't peek at a number that isn't shown. Only at the horizon does it render "significant" or
  "no effect detected".
- **"No effect detected" ≠ "no effect."** Reaching the horizon without significance means no effect *large enough
  to detect* was found — not that the variants are equivalent.

## What we deliberately did NOT build
**Sequential / always-valid methods** (mSPRT, group-sequential, Bayesian bandits) let you peek freely with
honest math — but that math is a library you import on faith, and the point of this course is statistics you can
*explain*. So sequential testing is documented as the graduate course (ADR-0011), gated behind study, not shipped
as a black box. *Ship the statistics you can explain; gate the ones you can't behind study.*

## The A/A test as a permanent guard
The simulation is also committed as a regression test (`packages/flags/src/aa-simulation.test.ts`): if a refactor
ever inflates the fixed-horizon false-positive rate above ~7%, or drops the peeking-vs-fixed gap, the build fails.
The strongest argument in this sprint is a number that keeps proving itself.
