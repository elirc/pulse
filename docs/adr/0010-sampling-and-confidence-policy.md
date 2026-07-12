# ADR-0010 — Sampling, confidence, and query-cost policy

**Status:** accepted (S12) · **Deciders:** Pulse course · **Revisited:** —

## Context

By S12 the read path is ClickHouse (S07) and the query language is stable. Three cost pressures now bite at
scale:

1. **The same shapes dominate.** The S12 query-shape audit (`docs/perf/query-shape-audit.md`) found ~70% of load
   is daily count/uniques for a single event with no filter or breakdown — hot *and* historically immutable.
2. **Interactive exploration is expensive and doesn't need to be exact.** An analyst dragging a date range wants
   *fast*, not the last digit. A number going into a board deck wants the opposite.
3. **High-cardinality breakdowns and noisy tenants** can each melt the cluster: a breakdown by `session_id`
   returns thousands of series; one project's dashboard can fire dozens of heavy queries at once.

S05's SPA-vs-rollup debate deferred pre-aggregation until the interest rate was *measured*. It now is.

## Decision

- **Pre-aggregate the hot, stable shapes only.** `events_daily` (AggregatingMergeTree, `sumState`/`uniqState`)
  materializes daily count + uniques per (project, event). The compiler routes an *eligible* spec (day interval,
  one event, no filter, no breakdown) to the rollup transparently, and stamps `x-served-by: rollup|raw` so the
  path is always visible. **Parity is a release gate**, not a hope (`rollup-parity.test.ts`).
- **Sampling is opt-in for interactive queries, never for saved ones.** A `sample:true` request reads a 10%
  `SAMPLE`, and the response carries the scaled estimate **and its 95% CI**. Saved insights and dashboards are
  always exact-or-rollup. The dividing line is one question: **"will this number be quoted?"**
- **Never render a sampled number as exact.** The UI shows `~12,400 ±3%` with an amber notice; the tilde and the
  ± are product features, not decoration.
- **Un-sample when the sample can't deliver signal.** If total observed falls below the reliability floor
  (normal-approximation breaks for rare events / tiny samples), the server silently re-runs the query exact and
  returns real counts (`x-sampled: unsampled`). Speed was requested; a lie is never the fallback.
- **Cost guards.** Per-property cardinality tracking (in-stream HLL) powers a hard guard: a breakdown above
  ~10k distinct is forced to top-N + "Other". A per-**project** concurrency cap rejects the (N+1)th in-flight
  query with `429 + Retry-After`. ClickHouse `max_execution_time` kills runaway scans. Every query logs a cost
  line.

## Rationale

**Approximation is a contract, not a shortcut.** Every approximate answer in Pulse — `uniq()`'s HLL (S07), the
cardinality sketch, the sample — ships with a *documented, bounded, opt-out-able* error. The moment an
approximate number is presented as exact, the contract is broken and trust with it. So the honesty lives in the
type and the pixels: the response is a `{ sampled, rows:[{value, ci95, reliable}] }` envelope, and the chart
renders the uncertainty.

**Speed/accuracy is a per-audience contract, not a global setting.** The same person wants different guarantees
exploring vs. reporting. Encoding that as "interactive may sample, saved may not" puts the decision where the
audience is known, instead of a server-wide flag that's wrong for half of callers.

**Fairness is a scheduler decision you make, or an incident you host.** A global query budget is invisible until
a tenant blows it for everyone; a per-project cap makes a busy tenant throttle *itself*. Reject-don't-queue is
deliberate — a query the analyst has abandoned is waste, and an unbounded internal queue just relocates the
overload one layer down.

## Consequences

- Two query paths (rollup, raw) must stay in agreement forever → parity is a permanent CI gate, and any rollup
  schema change re-runs it. A silent divergence would corrupt 70% of load invisibly — the worst failure mode, so
  it gets the strongest guard.
- Sampled numbers can differ run-to-run within their stated CI; that's correct and labeled. Saved dashboards
  never do.
- The cardinality guard changes results (top-N + Other) with a notice — an analyst who needs the full tail must
  narrow the query, not fight the guard.
- The concurrency cap is per API instance and in-memory; behind N replicas the effective cap is N× — acceptable
  for a guardrail (not a billing quota). A global quota would need Redis and is out of scope here.
- **Links:** ADR-0002 (measure before you optimize — this is the S05 rollup debate paid off with data),
  ADR-0007 (ClickHouse + `uniq()` HLL, the first bounded-approximation contract), the S05 top-N/Other pivot
  (generalized here into a universal guard).
