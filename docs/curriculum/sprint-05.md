# Curriculum Note — Sprint 5: Insights v1 — Trends + Live Events → v0.5.0

The MVP ships. It works, and — the point of the whole course — we can prove exactly how much load it survives.
That number is now the plot.

## Learning objectives
- Build a query builder over user input **safely**: a closed AST compiled to parameterized SQL, never string
  concatenation.
- Meet the expensive verbs of analytics (`COUNT(DISTINCT)`, unbounded `GROUP BY`) and the guards they need.
- Understand why saved insights persist a **definition**, not results — the seam that lets S07 swap the backend.
- Commit a **baseline**: turn "it feels slow" into "it crossed the line we drew in S01."

## Key concepts
- **📘 A closed AST is what makes the query builder safe.** Users compose from a fixed vocabulary (allowlisted
  metric / interval / operators; property names and values as *data*). The compiler inlines only zod-validated
  enums; everything else is a bound param. A user cannot reach the SQL text, so a user cannot inject SQL — the
  guarantee is mechanical, not hopeful. (Tracer S10's allowlist lesson, reused verbatim.)
- **📘 `COUNT(DISTINCT)` is the expensive verb.** "Unique users" can't be summed across buckets or shards the
  way `count(*)` can — it needs to see every id. Exact now on Postgres; approximate (HLL-shaped) thinking
  arrives with ClickHouse in S07 and sampling in S12.
- **⚠️ "Daily" is a timezone opinion.** We bucket in UTC for now and say so; real product-analytics buckets in
  the *project's* timezone, and getting that wrong shifts every midnight-crossing event into the wrong day.
- **📘 Version the query definition, migrate the compiler.** Saved insights outlive query engines. Persisting a
  versioned `TrendSpec` (not a materialized answer) is precisely what lets S07 point a hundred saved insights at
  ClickHouse by changing the compiler, touching none of them.
- **📘 Unbounded `GROUP BY` is a memory grenade.** Break down by a high-cardinality property and you get
  thousands of series. Top-N + "Other" is the guard — and "Other" is a design pattern, not an afterthought.
  (Note the subtlety: folding summed counts is wrong for the *unique* metric — one more reason S12 revisits it.)
- **🔍 One full-loop E2E is worth fifty unit tests.** A single test that traverses every boundary (SDK → ingest
  → stream → consumer → store → trend) is the confidence that the *seams* line up, and it's the regression net
  the S07 migration will rely on: a trend that still equals its captured value after the backend swap proves the
  migration behaviorally correct.
- **📘 Committed baselines turn feelings into facts.** `docs/perf/baseline-01.md` records where the trend query
  crosses the ~2 s line (~10M rows, ~4.2 s) — the "before" photo S07 holds up against Postgres.

## The debate, cashed
**Query raw events live vs precompute daily rollups now?** Resolved: **raw now.** Rollups are fast dashboards
*and* a debt against flexibility (any filter, any breakdown, no staleness) — and we haven't *earned* them,
because we have no measured pain yet. The baseline doc starts the pain ledger; rollups return in S12 as
*measured* optimizations. *Precomputation is a debt against flexibility — take it on only against measured
interest.*

## Exercise questions
1. A user types `plan'; DROP TABLE "Event"; --` as a filter value. Trace it through the compiler and say exactly
   where it ends up. What property of the AST guarantees it can't run?
2. Why can't `count(distinct distinctId)` be summed across daily buckets to get a weekly unique count? What
   *can* you do instead, and what does it cost?
3. You saved 100 insights, then S07 moves events to ClickHouse. What exactly has to change, and what doesn't —
   and which design decision this sprint made that possible?
4. A breakdown by `$url` returns 4,000 series. Which guard fires, what does the chart show instead, and why is
   the *unique*-metric version of "Other" subtly wrong?
5. Read `baseline-01.md`. At what row count does the trend query blow ADR-0002's criterion #2, and why *earlier*
   than the S01 estimate?
6. The full-loop E2E runs entirely in memory. Name one class of bug it can catch that the unit tests can't, and
   one it *can't* catch that only the real-infra lab run will.
