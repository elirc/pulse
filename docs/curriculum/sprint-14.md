# Curriculum Note — Sprint 14: Feature Flags & Experiments

The loop closes. The product now measures *itself* — flags it can turn on for a fraction of users, and
experiments that tell it whether the change worked. The discipline of the sprint is one line: **refusing to let
the product lie**, first about who saw what, then about what the numbers mean.

## Learning objectives
- Understand **hash-as-coordination**: deterministic bucketing assigns variants with no database and no network.
- Prove bucketing's three properties (uniformity, stickiness, independence) — and know why independence is the
  subtle one.
- Distinguish **exposure from assignment**, and why the experiment measures exposure.
- Write a two-proportion z-test you can explain, and internalize the **peeking problem** from a simulation.

## Key concepts
- **📘 Hash-as-coordination.** `bucket(flagKey, distinctId)` places every user in a stable [0,1) slot. Every
  evaluator — server, SDK, backfill — computes the same slot, so a user sees one variant everywhere, with no
  assignment table and no write on evaluation. What you give up: you can't hand-pick membership, and changing a
  rollout % reshuffles no one already in (stability, by design). What you buy is the whole system.
- **⚠️ Independence is the property you'll forget.** Leave the flagKey out of the hash and *every* experiment
  reuses one split — a user in the treatment of flag A is in the treatment of flag B, correlating all your
  results. The chi-square uniformity test caught a real distribution bug (raw FNV-1a's weak high bits → a
  murmur3 finalizer); the Pearson independence test guards the flagKey. Property tests earn their keep.
- **📘 Local evaluation is non-negotiable on someone else's hot path.** A network call per flag check is
  disqualifying. The SDK fetches a payload once and buckets locally; the cost is a staleness contract (cached →
  bootstrap → fresh) and a byte-identical hash copy pinned by a **parity test**.
- **📘 Exposure ≠ assignment.** Assignment is free — bucketing decides a variant for everyone. The experiment
  needs who *saw* the difference, so `$flag_evaluated` (deduped per session) is the observable, and it becomes
  step 1 of an exposure→goal funnel. Analyzing by assignment dilutes real effects with never-exposed users.
- **📘 The z-test, owned.** Two proportions, pooled variance under the null, a CI on the lift from the unpooled
  SE. ~40 lines, assumptions listed (independence, fixed n, normal approximation). Statistics as code you can
  derive beats a library you invoke on faith.
- **🔍 The strongest argument in the sprint is a simulation.** 1000 A/A experiments (true lift zero): a peeker
  who stops at the first p<0.05 hits **~26%** false positives; a fixed-horizon look sits at **~5%**. Committed as
  a regression test, so the number keeps proving itself. Prose doesn't convince; a null experiment declared a
  winner one time in four does.
- **📘 "No effect detected" is the product's statistical honesty.** Not "no effect" — absence of significance is
  not equivalence. The UI shows collecting / significant / no-effect-detected and a progress bar toward the
  required n, never a bare live p-value. This is S12's tilde-and-± contract, extended from sampled numbers to
  inferred ones.

## The debate, cashed
**Fixed-horizon vs. sequential (always-valid) testing?** Sequential lets you peek freely, but the math (mSPRT,
group-sequential) is a library you import on faith. Fixed-horizon is teachable, honest, and restrictive.
**Resolution:** fixed-horizon with required-n up front and a UI that hides the verdict (shows progress) while
collecting; sequential documented as the graduate course. *Ship the statistics you can explain; gate the ones you
can't behind study.* (ADR-0011.)

## Exercise questions
1. Two servers and a browser all evaluate the same flag for the same user with no shared database. How do they
   agree? What single input, removed from the hash, would break independence across flags — and which test
   catches it?
2. You ramp a rollout from 10% to 20%. Which already-bucketed users change variant? Why is the answer "none" a
   feature?
3. A flag is checked on every React render. How many exposure events should fire, and how does the SDK guarantee
   it? Why exposure and not assignment?
4. Derive the pooled two-proportion z-test for 200/1000 vs 240/1000. Now state the three assumptions your p-value
   depends on.
5. Run `node docs/experiments/peeking-simulation.mjs`. Explain why a *true-zero* experiment produces a 26% "win"
   rate under peeking. What in the Pulse UI makes peeking impossible rather than merely discouraged?
6. An experiment reaches its horizon at p=0.4. Write the sentence the UI shows. Why is "no effect detected"
   correct and "the variants are equivalent" wrong?
