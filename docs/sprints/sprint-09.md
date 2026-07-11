# Sprint 09 — Retention & Cohorts

**Branch:** `sprint-09/retention-cohorts` · **Size:** M/L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Retention matrices (the triangle chart every product team argues over) and cohorts — property-based and behavioral — with materialized membership computed by jobs. The sprint's tension: compute-on-read vs precompute, decided per feature with reasons.

## A — Issues
1. `Retention insight: cohort-by-first-event × return-event, day/week grids`
2. `Cohorts: property-based (live) and behavioral (did X in period)`
3. `Materialized cohort membership + recompute job`
4. `Cohort filters usable in trends/funnels/retention`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(api): retention query — first-seen bucketing × return activity grid (CH)` | computed on read: retention grids are small outputs over big scans — CH's home game |
| 2 | `feat(web): retention triangle — heatmap per dataviz conventions, cohort-size column` | percentage vs absolute toggle; the classic misread (tiny cohorts, loud percentages) flagged in UI |
| 3 | `test(api): retention fixtures — hand-traced personas across weeks; timezone boundary cases` | week bucketing × project timezone: the recurring villain |
| 4 | `feat(db): Cohort model — definition AST (property predicates | behavioral: event+count+window)` | one AST grammar for both kinds (🔗 Tracer S10 filter AST, third appearance of the pattern) |
| 5 | `feat(api): property cohorts — compiled live into queries (no materialization)` | cheap predicates inline fine |
| 6 | `feat(consumer+jobs): behavioral cohorts — membership materialized, BullMQ recompute on schedule` | behavioral = a scan per evaluation; materialize + staleness contract (recomputed hourly, `computedAt` shown in UI) |
| 7 | `feat(api): cohort filters in trends/funnels/retention — membership join` | |
| 8 | `test(jobs): recompute idempotency + staleness metadata; membership diff logging` | membership churn is a signal analysts want; log adds/removes per run |
| 9 | `test(e2e): build behavioral cohort → filter a funnel by it → numbers match fixture` | |
| 10 | `docs: ADR-0008 materialize behavioral, inline property cohorts; curriculum note` | |

## C — Review order
Retention query (1) + its timezone tests (3) → the cohort AST (4) → the materialize/inline split (5–6 with ADR).

## D — Teaching comments (~9)
- retention on read — 📘 the decision grid: output size × scan cost × freshness need; retention = small output, tolerable scan, wants freshness → compute on read
- behavioral materialization — 📘 same grid, opposite corner: reused by many queries, expensive to evaluate, tolerates staleness → precompute; ADR-0008 is the grid written down
- staleness as UI — 🔍 review-lens: `computedAt` shown to analysts isn't decoration, it's the contract; hidden staleness is how dashboards lie
- week-bucket timezones — ⚠️ "week 0" depends on whose Monday; fixtures pin it (🔗 third course where time zones eat a sprint's error budget — pattern recognition complete)
- membership diffs — 📘 derived data should explain its changes; a cohort that silently shrinks 40% is an incident, and the diff log is its black box
- one AST, two kinds — 🔗 grammar reuse: property predicates compose into behavioral definitions; don't build two filter languages

## E — Debate
**"Recompute behavioral cohorts on schedule vs on event-stream triggers?"** Triggers: fresh, but every event potentially touches N cohorts — write amplification on the hot path. Schedule: bounded cost, bounded staleness. **Resolution:** schedule (hourly default, per-cohort override), with the trigger design sketched for when a customer pays for freshness. Lesson: *freshness is a feature with a unit price; sell it deliberately.*

## F/G — Close
- Squash: `feat(sprint-09): retention & cohorts (closes #…)`
- Deferred: cohort CSV export, lifecycle charts (new/returning/resurrected), per-cohort freshness tiers.
- Recap idea: *precompute vs compute-on-read is a grid, not a religion — place each feature on it, in writing.*
