# Sprint 05 — Insights v1: Trends + Live Events → v0.5.0

**Branch:** `sprint-05/insights-mvp` · **Size:** M/L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Ship the MVP: a trends insight builder (counts, unique users, breakdowns, date grouping), a live events feed, demo data, deploy — and **k6 baseline #1 committed to the repo**, the "before" photo that S7 will hold up against Postgres.

## A — Issues
1. `Trend queries: total counts / unique persons, by day-week-month, filtered by event + properties`
2. `Insight builder UI: event picker, breakdown by property, saved insights`
3. `Live events feed (latest 100, auto-refresh)`
4. `Demo data generator + deploy + E2E`
5. `k6 baseline #1: ingest + query timings at 1M/10M rows — committed doc`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(api): trend query builder — parameterized SQL over events (count, unique distinctId, date_trunc buckets)` | property filters compile from a closed AST (🔗 Tracer S10's allowlist lesson, reused verbatim) |
| 2 | `feat(api): breakdowns — GROUP BY property with top-N + other bucketing` | top-N guard from day one… but only in trends (🔗 S12 generalizes) |
| 3 | `feat(db): Insight model — saved query definitions (JSON)` | insights are data; the query def schema is versioned from v1 |
| 4 | `feat(web): insight builder — event picker, filters, breakdown, interval; chart per dataviz` | |
| 5 | `feat(api+web): live events feed — latest 100, 5s polling` | **[flaw #4]** raw-table query, no index discipline; fine at demo scale (harvest S11/S12) |
| 6 | `feat(tools): demo data generator — 30 days, realistic funnels-shaped traffic (loadgen preset)` | seeded personas and journeys so later funnels/retention have signal |
| 7 | `test(api): trend correctness — golden fixtures (hand-computable expected counts)` | 🔗 Meridian S12 reconciliation pattern |
| 8 | `test(e2e): sdk on a demo page → event → appears in trend + live feed` | the full-loop E2E: SDK → ingest → stream → consumer → PG → chart |
| 9 | `ci+deploy: dockerfiles ×4 apps, deploy, health gates (fast-forward)` | |
| 10 | `docs: k6 baseline #1 — ingest 2k/s sustained; trend query at 1M and 10M rows` | **the "before" photo**: 10M-row trend query ~4.2s; the ADR-0002 exit criteria get their first real datapoints |
| 11 | `docs: curriculum note sprint 05` | |

## C — Review order
Trend SQL (1–2) → golden fixtures (7) → full-loop E2E (8) → **the baseline doc (10) with ADR-0002 open beside it**.

## D — Teaching comments (~9)
- unique users — 📘 `COUNT(DISTINCT)` is the expensive verb of analytics; exact now, 🔗 approximate (HLL-shaped) thinking arrives with ClickHouse in S7 and sampling in S12
- date_trunc + timezones — ⚠️ "daily" is a timezone opinion; project timezone setting, bucketing in *its* zone (🔗 Meridian S12 lesson, second appearance)
- query-def versioning — 📘 saved insights outlive query engines; version the definition, migrate the compiler — this is what lets S7 swap the backend under 100 saved insights
- top-N bucketing — 📘 unbounded GROUP BY on a user-supplied property is a memory grenade; 'Other' as a design pattern
- full-loop E2E — 🔍 review-lens: one test that traverses every system boundary is worth fifty unit tests for confidence, and it's the regression net the S7 migration will rely on
- baseline doc — 📘 committed baselines turn "it feels slow" into "it crossed the line we drew in S1"

## E — Debate
**"Query raw events live vs precompute daily rollups now?"** Rollups: fast dashboards today. Raw: total flexibility (any filter, any breakdown), no staleness — and we haven't *earned* rollups yet (no measured pain). **Resolution:** raw now; the baseline doc starts the pain ledger; rollups return in S12 as *measured* optimizations. Lesson: *precomputation is a debt against flexibility — take it on only against measured interest.*

## F/G — Close
- Squash: `feat(sprint-05): trends, live events, deploy (closes #…)`
- **Post-merge:** deploy → demo script (paste snippet on demo page → watch chart) → tag **`v0.5.0`** → MVP retro.
- Ledger: flaw #4 recorded.
- Recap idea: *the MVP works and we can prove exactly how much load it survives — that number is now the plot of this course.*
