# Sprint 12 — Sampling, Cardinality & Query Cost

**Branch:** `sprint-12/sampling-cardinality` · **Size:** L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** The data-engineering judgment sprint: pre-aggregation for the hot query shapes, defenses against high-cardinality properties, query sampling with **honest confidence UI**, and cost guards. The theme — "close enough, fast, and labeled as such."

## A — Issues
1. `Pre-aggregation: daily rollup materialized views for top query shapes`
2. `Cardinality guards: per-property distinct tracking, top-N + Other enforcement everywhere`
3. `Query sampling: SAMPLE support with confidence intervals in the UI`
4. `Cost guards: per-query limits, timeouts, per-project concurrency`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `docs: query-shape audit — 30 days of query logs bucketed by shape and cost` | audit-first (the S13 methodology arriving early); finding: 70% of load is daily-count shapes that never change historically |
| 2 | `feat(db): CH materialized views — daily event counts + daily uniques per project/event` | AggregatingMergeTree; the rollup answers S5's debate *with the measured interest rate now known* |
| 3 | `feat(api): compiler routes eligible queries to rollups transparently` | eligibility rules explicit + logged; parity goldens rollup-vs-raw |
| 4 | `feat(consumer): property cardinality tracker — per-property approximate distinct counts` | cheap HLL-style sketch per property, surfaced in a data-management UI |
| 5 | `feat(api): cardinality guard — breakdowns on >10k-distinct properties forced to top-N + Other, with UI notice` | generalizes S5's trends-only guard to every insight type |
| 6 | `feat(api): sampling — SAMPLE 0.1 for interactive exploration, ±CI computed and returned` | |
| 7 | `feat(web): confidence UI — sampled results show "~12,400 ±3%" + un-sample button` | the honesty contract: never render a sampled number as exact |
| 8 | `feat(api): cost guards — max-execution-time, per-project query concurrency, cost logging` | analytics multi-tenancy: one heavy tenant must not starve others |
| 9 | `test(api): rollup parity goldens; CI math property tests; guard behavior` | |
| 10 | `docs: ADR-0010 sampling & confidence policy; curriculum note` | |

## C — Review order
Query-shape audit (1) → rollup + routing (2–3) → the confidence UI (6–7) → cost guards (8).

## D — Teaching comments (~10)
- audit before rollups — 🔗 S5's debate resolution promised "rollups when measured" — this is the measurement; precompute the shapes that are hot *and* stable, nothing else
- transparent routing — ⚠️ silent rollup routing that ever disagrees with raw destroys trust permanently; parity goldens + a debug header showing which path served the query
- cardinality sketches — 📘 you can't guard what you don't count; a per-property distinct sketch costs almost nothing in-stream and powers every downstream guard
- top-N + Other — 📘 'Other' is not a hack, it's the honest representation of a long tail; making it universal is a data-quality position
- CI math — 📘 sampling error for proportions and counts, in ~15 lines; where the formula breaks (tiny samples, rare events) — and the guard that un-samples those
- never-exact rendering — 🔍 review-lens: the tilde and the ± are product features; an analyst who quotes a sampled number in a board deck must have been told
- per-project concurrency — 📘 noisy-neighbor economics: fairness is a scheduler decision you make, or an incident you host

## E — Debate
**"Auto-sample big queries vs analyst opt-in?"** Auto: fast by default, but silently different numbers day-to-day. Opt-in: honest, slower default. **Resolution:** auto-sample only *interactive exploration* (unsaved queries) with loud labeling; saved insights and dashboards always exact-or-rollup. The boundary is "will this number be quoted?" Lesson: *speed/accuracy tradeoffs are per-audience contracts, not global settings.*

## F/G — Close
- Squash: `feat(sprint-12): rollups, cardinality guards, sampling, cost control (closes #…)`
- **Lab (break-it #3):** junior crafts a pathological property (uuid-valued) with loadgen, watches the cardinality tracker and guards respond, then disables the guard on a branch and documents the damage.
- Recap idea: *big-data maturity is knowing which numbers must be exact, which may be approximate, and labeling both truthfully.*
