# ADR-0011 — Deterministic bucketing & fixed-horizon experiment methodology

**Status:** accepted (S14) · **Deciders:** Pulse course · **Revisited:** —

## Context

S14 closes the analytics loop: the product ships feature flags, and measures their effect with A/B experiments.
Two design questions decide everything downstream: **how is a user assigned to a variant**, and **how do we
decide an experiment worked**.

## Decision

### Assignment: deterministic bucketing, no stored assignment
A variant is `bucket(flagKey, distinctId) → [0,1)`, an FNV-1a + murmur3-fmix32 hash, read for a rollout gate and
a weighted variant split (independent salts). No assignment table; no write on evaluation.
- **Sticky without storage** — same (flag, user) → same bucket forever, on any evaluator.
- **Agreed across evaluators** — server, SDK, and backfill compute the identical bucket. The SDK carries a
  byte-identical copy of the hash (it can't import the server package into a zero-dep bundle); a **parity test**
  is the price of the copy.
- **Independent across flags** — the flagKey is IN the hash input, so experiments don't share a split. Omitting
  it correlates every experiment; the chi-square + Pearson **property tests** exist to catch exactly that.

### Analysis: exposure-based, fixed-horizon
- **Exposure, not assignment.** The unit of analysis is `$flag_evaluated` (who *saw* the variant), not who was
  bucketed. Assignment-based analysis dilutes effects with users who never experienced the change.
- **Two-proportion z-test** on exposure→goal conversion (the S08 funnel with exposure as step 1), with a CI on
  the lift. ~40 lines we own, assumptions stated.
- **Fixed horizon.** Required sample size is decided up front; the UI shows *progress toward n*, not a live
  p-value, while collecting — you can't peek at a number that isn't shown.
- **Honest wording.** Three states: collecting / significant / **"no effect detected"** (never "no effect" —
  absence of significance is not equivalence).

## Rationale

**Hash-as-coordination.** The deep idea is that a hash lets every evaluator agree on an assignment *without a
database and without communication*. The trade you accept: you can't hand-pick who's in a variant, and changing a
rollout percentage reshuffles no one who was already in (a feature — stability — not a bug). What you buy is
enormous: no assignment store, no read on the hot path of a stranger's app, and perfect server/SDK agreement.

**The peeking problem is the reason for the whole methodology.** A simulation, not an argument: 1000 A/A
experiments show a peeker's false-positive rate at ~26% versus a fixed horizon's ~5%. A p-value is calibrated for
one look; each peek is another draw against the line. So the product's job is to make peeking *impossible by
construction* — hide the verdict until the horizon — rather than trust discipline. (`docs/experiments/peeking.md`,
committed as a regression test.)

**Ship the statistics you can explain.** Sequential / always-valid methods (mSPRT, group-sequential) let you peek
honestly, but the math is a library you import on faith. This course ships the z-test because it can be derived
in front of you, and documents sequential testing as the graduate course — gated behind study, not shipped as a
black box.

## Consequences

- **Rollout changes don't rebalance existing users.** Ramping 10%→20% adds new users; it never moves someone who
  was already in. If you need re-randomization, you change the flag key (a new experiment), on purpose.
- **The SDK and server hashes must never diverge.** The parity test is load-bearing; a change to either hash is a
  breaking change to every live rollout and is caught in CI.
- **Underpowered experiments say "no effect detected", honestly.** Teams wanting to prove equivalence need a
  different (equivalence/TOST) design — noted, not built.
- **Sequential testing deferred.** Documented as the next study step; until then, peeking is structurally
  prevented, not permitted-with-caveats.
- **Links:** S08 funnel engine (exposure→goal), S09 cohort AST (flag targeting), S12 approximation-honesty
  contract (extended here from sampled to inferred numbers), the S14 curriculum note + peeking simulation.
