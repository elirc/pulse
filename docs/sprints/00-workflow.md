# Pulse — Sprint Execution Workflow

Same ritual as Meridian/Tracer; restated so this folder is self-contained when split into its own repo.

## Roles
- **Author (AI):** all code, commits, PR bodies, teaching comments, debate threads.
- **Learner (junior):** predict-before-reading (sketch an approach from the Phase A issues before opening the PR), review-before-reveal (own review comments precede the teaching comments), study merged PRs in the prescribed order, run labs. Co-authors the junior side of S8 and runs the S13 audit tooling.

## Lifecycle (Phases A–G)
- **A — Setup:** milestone, 3–6 issues, branch `sprint-NN/<slug>`.
- **B — Build:** ordered conventional commits. `[flaw]` = deliberate, logged in `flaw-ledger.md`. `[fix-later-in-PR]` = broken → failing test → fix, as a visible story.
- **C — Draft PR:** template body incl. **How to review** reading order. CI green unless scripted.
- **D — Teaching comments:** 8–20 inline, after the learner's review pass. Prefixes: `📘 concept` · `🔍 review-lens` · `⚠️ pitfall` · `🔗 connects`.
- **E — Planted debate:** question → options → resolution (+ ADR/commit when called for).
- **F — Finalize:** curriculum note with exercise questions; squash-merge `feat(sprint-NN): … (closes #…)`.
- **G — Post-merge:** deploy check (S5+), deferred issues, milestone close, Sprint Recap discussion, lab branch if scheduled, tags at S5/S15.

## Pulse-specific rules
1. **Numbers in every pipeline PR:** any commit touching the ingest path reports measured throughput/latency (traffic generator + k6) in the PR body. No perf claims without numbers.
2. **Idempotent consumers, always:** from S4, every stream consumer ships with a duplicate-delivery test. A consumer without one does not merge.
3. **SDK discipline:** `packages/sdk` has a CI-enforced bundle budget (<6KB gz), no external deps, semver from `v0.1.0`, and must never throw into the host page (top-level try/catch policy, tested).
4. **Labs:** after S3, S4, S7, S12, S13 — including "break it" labs where the junior drives the traffic generator until something falls over and writes up why.
5. Conventions otherwise identical: squash-only linear `main`, Conventional Commits, no red merges, TODOs need issues, flaw harvests quote the ledger.
