# Query-Shape Audit (S12) — 30 days of query logs, bucketed by shape and cost

S05's rollup debate resolved: *rollups when measured, not on a hunch.* This is the measurement. Before building
a single materialized view, we bucketed 30 days of production query logs by **shape** (the structural template,
params stripped) and by **cost** (p95 execution time × frequency), so we precompute only what is hot AND stable.

## Method
Every executed insight query is logged with its compiled shape hash (params removed), execution time, and rows
scanned. 30 days aggregated. (Audit-first — the S13 methodology, arriving early.)

## Findings

| Query shape | % of total load | p95 | Historically stable? | Rollup candidate? |
|---|---|---|---|---|
| daily `count(*)` by event, 30d window | **41%** | 380 ms | yes (past days never change) | ✅ |
| daily `count(distinct person)` by event | **29%** | 1.4 s | yes | ✅ (AggregatingMergeTree + `uniqState`) |
| breakdown by property (top-N) | 14% | 900 ms | no (arbitrary filters) | ❌ (can't precompute every filter) |
| funnels (windowFunnel) | 9% | 1.1 s | no | ❌ |
| retention grids | 5% | 2.2 s | partly | later |
| ad-hoc / everything else | 2% | varies | no | ❌ |

**The headline: ~70% of all query load is daily-count and daily-uniques shapes whose historical values never
change.** Those are the ideal rollup: hot (queried constantly), stable (yesterday's daily count is fixed
forever), and small (one row per project × event × day). Everything else — arbitrary-filter breakdowns, funnels,
ad-hoc — stays on the raw columnar path, because a rollup can only precompute the questions you named.

## Decision (drives commits 2–3)
- **Rollup** daily counts + daily uniques (AggregatingMergeTree materialized views).
- **Route** eligible queries (no property filter, day granularity, count/unique) to the rollup transparently —
  with parity goldens and a debug header so a routed query can be proven equal to raw.
- **Do NOT** rollup breakdowns/funnels/retention — the measured interest doesn't justify the precompute debt.

*Precomputation is a debt against flexibility; the audit is how you learn the interest rate before you borrow.*
