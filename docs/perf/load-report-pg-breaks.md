# Load Report — Postgres crosses the ADR-0002 exit criteria (S07, Act 1)

Six sprints ago, ADR-0002 wrote the numbers at which Postgres stops being enough. This report drives Postgres
**past** them, under witness, on the demo dataset scaled to production shape. The point of the exercise, stated
in S01: **we migrate on evidence, not fashion.** Here is the evidence.

## Setup
Reference lab (`docker compose` + `load/k6-ingest.js` + the demo generator bulk-loaded). Postgres 16, 8 vCPU /
32 GB, events table at **50M rows**, sustained ingest driven to **5,000 events/s**. Reproducible.

## Against the ADR-0002 exit criteria

| ADR-0002 criterion | Threshold | Measured now | Verdict |
|---|---|---|---|
| #1 Ingest pressure | insert p95 < 50 ms at target rate | at 5k/s, **consumer insert lag grows without bound** (queue depth climbs, never drains) | ❌ crossed |
| #2 Query pain | trend p95 < ~2 s at ~50M rows | 30-day `count(distinct personId)` trend p95 = **11.4 s** | ❌ crossed (5.7×) |
| #3 Operational | events table doesn't harm OLTP | `autovacuum` on the events table runs continuously; the `(projectId, ts)` + unique-`uuid` indexes are **~40% of table size** and their maintenance stalls the metadata DB | ❌ crossed |

### The graphs (committed as data; render in the lab)
- **`trend_p95_vs_rows.csv`** — trend p95 climbs roughly linearly with row count: 120ms @1M, 4.2s @10M, **11.4s @50M**. A btree scan aggregates every row in the window; there's no sub-linear path in a row store.
- **`consumer_lag_at_5k.csv`** — at 5k events/s the per-event enrichment + single-row-ish insert path can't keep up; lag climbs monotonically. (Two problems tangled here — one is storage, one is the enrichment stage; Act 2 separates them.)
- **`vacuum_and_bloat.csv`** — dead tuples and index bloat over a 24h soak; vacuum never catches up.

## Why this is a storage problem, not a tuning problem
The workload is `count(distinct person)` and `count(*)` over **three columns** (`ts`, `name`, `personId`) of
**tens of millions of rows**, filtered by arbitrary JSONB properties. That is the textbook OLAP shape: read a
few columns of many rows. A row store reads whole rows off disk to touch three fields; more RAM and better
indexes shift the constant, not the curve. This is what columnar engines exist for.

## The honest alternative (see the S07 debate + ADR-0007)
We also ran this exact load against a **partitioned-Postgres + rollups** spike branch. It helped ingest (smaller
per-partition indexes) but did **not** fix criterion #2 for *arbitrary-filter* `count(distinct person)` — the
rollups can't precompute every filter, so ad-hoc trends still scan raw partitions. Its numbers are published in
ADR-0007 beside ClickHouse's. We evaluate alternatives by running them, and we publish the loser's numbers too.

## Verdict
All three exit criteria are crossed, on measurements, against thresholds written before the pain. **Migrate.**
Act 2 builds the ClickHouse engine; Act 3 executes the live migration; baseline #2 is the after-photo.
