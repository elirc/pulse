# Sprint 14 — Feature Flags & Experiments

**Branch:** `sprint-14/flags-experiments` · **Size:** L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Close the analytics loop: feature flags evaluated in the SDK via deterministic bucketing, exposure events feeding the pipeline, and A/B experiment analysis with real significance testing — including the peeking problem, taught honestly.

## A — Issues
1. `FeatureFlag: boolean + multivariate, percentage rollouts, property targeting`
2. `SDK flag evaluation: local bucketing, payload fetch, bootstrap, exposure events`
3. `Experiments: flag-linked, assignment/exposure tracking, goal metrics`
4. `Results: conversion comparison with significance (z-test), peeking guidance`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(db+api): FeatureFlag — variants, rollout %, targeting predicates (cohort AST reused)` | 🔗 the S9 AST's fourth consumer |
| 2 | `feat(shared): deterministic bucketing — hash(flagKey, distinctId) → [0,1)` | sticky without storage: same input, same bucket, any evaluator; the golden property |
| 3 | `test(shared): bucketing properties — uniformity (chi-square on 100k ids), stickiness, independence across flags` | independence: bucket(flagA) must not correlate with bucket(flagB) — the subtle one; flagKey in the hash is why |
| 4 | `feat(sdk): flag evaluation — payload fetch on init, local evaluate, bootstrap for first-paint, offline cache` | evaluation is local: no network per check; SDK bundle budget renegotiated in the open (+1.2KB, documented) |
| 5 | `feat(sdk): exposure events — $flag_evaluated capture with dedupe-per-session` | exposure ≠ assignment: measure who *saw* the variant; per-session dedupe keeps volume sane |
| 6 | `feat(db+api): Experiment — flag link, hypothesis, goal metric (event or funnel), start/stop` | hypothesis is a required text field — the experiment registry as scientific hygiene |
| 7 | `feat(api): results — conversion per variant from exposure→goal, two-proportion z-test, CI on lift` | reuses the funnel engine (🔗 S8) with exposure as step 1 |
| 8 | `feat(web): experiment results UI — lift, CI band, significance state, sample-size progress` | three states: "collecting" (with required-n progress), "significant", "no effect detected"; never a bare p-value |
| 9 | `docs: peeking problem — why checking daily and stopping at p<0.05 inflates false positives; fixed-horizon policy` | simulation notebook committed: 1000 A/A experiments, ~30% "significant" under peeking — the number that teaches |
| 10 | `test(api): results math golden tests + A/A simulation as regression test` | |
| 11 | `test(e2e): create flag → sdk gates a demo feature → experiment collects → results render` | |
| 12 | `docs: ADR-0011 bucketing & experiment methodology; curriculum note` | |

## C — Review order
Bucketing + its property tests (2–3) → exposure semantics (5) → **the peeking doc with the A/A simulation (9)** → results UI states (8).

## D — Teaching comments (~10)
- deterministic bucketing — 📘 hash-as-coordination: every evaluator everywhere agrees without a database; what you give up (rebalancing a rollout reshuffles no one — by design)
- independence property — ⚠️ forgetting the flag key in the hash correlates all your experiments; the chi-square test that would catch it
- local evaluation — 📘 flags on the hot path of *someone else's app*: network-per-check is disqualifying; payload staleness contract instead
- exposure vs assignment — 📘 the experiment measures people who *experienced* the difference; assignment-based analysis dilutes effects with never-exposed users
- z-test in 20 lines — 📘 two proportions, pooled variance, the actual formula — statistics as code you own, with its assumptions listed
- A/A simulation — 🔍 review-lens: the strongest argument in this sprint is a simulation, not prose; 1000 null experiments don't lie
- "no effect detected" — 📘 absence of significance is not equivalence; the UI wording is the product's statistical honesty (🔗 S12's tilde-and-± contract, extended)

## E — Debate
**"Fixed-horizon testing vs sequential (always-valid) methods?"** Sequential: peek freely, but the math (mSPRT etc.) is a library you import on faith. Fixed-horizon: teachable, honest, restrictive. **Resolution:** fixed-horizon with required-sample-size upfront and a UI that *shows* progress instead of p-values while collecting; sequential documented as the graduate course. Lesson: *ship the statistics you can explain; gate the ones you can't behind study.*

## F/G — Close
- Squash: `feat(sprint-14): flags, experiments, significance (closes #…)`
- Deferred: sticky multi-armed rollout ramps, holdout groups, sequential testing spike.
- Recap idea: *the loop closes — the product now measures itself; the discipline is refusing to let it lie.*
