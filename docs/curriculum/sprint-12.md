# Curriculum Note — Sprint 12: Sampling, Cardinality & Query Cost

The data-engineering judgment sprint. The theme is one sentence: **close enough, fast, and labeled as such.**
Every optimization here trades exactness for cost — and every one ships the trade *visibly*, as a bounded,
documented, opt-out-able contract. The senior move isn't making things approximate; it's making the
approximation honest.

## Learning objectives
- Precompute the shapes that are **hot AND stable**, nothing else — and prove rollup==raw as a release gate.
- Compute sampling error for counts in ~15 lines, and know **where the formula breaks**.
- Render uncertainty as a product feature (`~12,400 ±3%`), never launder a sampled number into an exact one.
- Defend a multi-tenant cluster with **per-project** guards (cardinality, concurrency, exec-time).

## Key concepts
- **🔗 Measure, then precompute — the S05 debate paid off.** S05 deferred rollups until the interest rate was
  known; the S12 query-shape audit *is* the measurement (70% daily-count/uniques, hot and immutable). Precompute
  reifies a measured access pattern; precomputing on a hunch just moves cost around. ADR-0002's "measure first"
  becomes an action here, not a slogan.
- **⚠️ Transparent routing that ever disagrees with raw destroys trust permanently.** The compiler silently
  sends eligible queries to `events_daily`. That's only safe because (a) `x-served-by` makes the path visible and
  (b) `rollup-parity.test.ts` is a permanent CI gate proving the two paths agree — including the trap where two
  same-day events from one person are **2 for totals, 1 for uniques**. A silent divergence would corrupt 70% of
  load invisibly. The worst failure mode gets the strongest guard.
- **📘 Approximation is a contract: bounded, documented, opt-out-able.** `uniq()` HLL (S07), the per-property
  cardinality sketch, and the 10% sample are all the same shape — a stated error bound with an exact escape
  hatch. The instant one is shown as exact, the contract breaks. So honesty lives in the *type* (`{value, ci95,
  reliable}`) and the *pixels* (the tilde and the ±).
- **📘 Sampling CI in ~15 lines — and where it breaks.** For a count observed in a p-sample, estimate ≈
  observed/p and SE ≈ √(observed·(1−p))/p; 95% CI = ±1.96·SE. It breaks for **small observed counts** (rare
  events, tiny samples) where the normal approximation is invalid — so below a floor we flag `reliable:false` and
  **un-sample**: re-run exact and return real numbers. The analyst asked for speed but never receives a lie.
- **🔍 The tilde and the ± are features, not decoration.** Review-lens: an analyst who quotes a sampled number in
  a board deck must have been *told* it was sampled. That's why sampling is opt-in for interactive queries and
  *forbidden* for saved insights/dashboards. The dividing line is one question — **"will this number be
  quoted?"** — and it lives where the audience is known, not in a server-wide flag.
- **📘 'Other' is a data-quality position, made universal.** S05 folded a trend's long tail into "Other"; S12
  makes it a hard guard on *every* breakdown via a per-property distinct sketch. You can't guard what you don't
  count — the sketch costs almost nothing in-stream and powers the guard downstream.
- **📘 Noisy-neighbour economics: fairness is a scheduler decision you make, or an incident you host.** A global
  query budget is invisible until a tenant blows it for everyone. A **per-project** concurrency cap makes a busy
  tenant throttle itself; reject-don't-queue (`429 + Retry-After`) is deliberate, because a query nobody's
  waiting for is waste and an unbounded queue just relocates the overload.

## The debate, cashed
**Auto-sample big queries vs. analyst opt-in?** Auto is fast-by-default but silently different day-to-day;
opt-in is honest but slower. **Resolution:** auto-sample *only interactive exploration* (unsaved queries) with
loud labeling; saved insights and dashboards are always exact-or-rollup. The boundary is "will this number be
quoted?" *Speed/accuracy tradeoffs are per-audience contracts, not global settings.* (ADR-0010.)

## Exercise questions
1. The audit says 70% of load is daily count/uniques with no filter. Why does that specific shape make a *good*
   rollup candidate, and what property besides "hot" does it need?
2. `rollup-parity.test.ts` compares the rollup to the raw interpreter. Construct the input where a naive rollup
   would over-count uniques, and explain why `uniqState` (not `sum`) is required.
3. Derive the 95% CI for a count of 400 observed in a 10% sample. Now do it for 4 observed — what does the code
   do differently, and why?
4. A dashboard tile and an ad-hoc exploration run the *same* spec. One may sample, one may not. Which, and what
   single question decides it?
5. A breakdown by `session_id` (1.2M distinct) is requested. Trace what the cardinality guard returns and what
   header the analyst sees. How would they legitimately get the full tail?
6. Project A fires 6 heavy queries at once with the cap at 4. What does the 5th receive, and why is rejecting it
   better than queuing it? How does this *not* affect quiet Project B?
