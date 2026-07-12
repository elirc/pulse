# Performance Baseline #2 (S07) — the after photo

Baseline #1 (S05) photographed Postgres crossing the ADR-0002 line. The Act-1 load report drove it over all
three criteria at 50M rows. This is the same measurements on **ClickHouse**, after the migration — held up
beside the before.

## Same rig, same queries
Reference lab, `docker compose` (now including the `clickhouse` service), events bulk-loaded to matched row
counts, the identical `TrendSpec` compiled to each engine.

## Ingest
| Build | Sustained | p95 | Notes |
|---|---|---|---|
| S03 synchronous (baseline #1) | ~1,600/s before p95>50ms | 52 ms | insert on the hot path |
| S04 pipeline → Postgres | 2,000/s | 9 ms | lagged at 5k/s (Act-1 report) |
| **S07 pipeline → ClickHouse** | **12,000/s sustained**, headroom left | **7 ms** | batch enrichment (flaw #2 harvest) + buffered columnar inserts |

## Trend query — the criterion #2 rematch
30-day `count(distinct person)` trend, warm.

| Events | Postgres p95 (baseline #1) | **ClickHouse p95** | Speedup |
|---|---|---|---|
| 1M | 120 ms | ~12 ms | 10× |
| 10M | 4.2 s | **~90 ms** | **~47×** |
| 50M | 11.4 s | ~180 ms | ~63× |

`uniq()` (HyperLogLog) does the distinct-person count in a single pass with ~0.5% error; `uniqExact()` is
available for the rare exact need. The golden fixtures pass within the defined tolerance.

## What the migration cost, honestly
- **Two stores to operate during the migration** (ended by the decommission — we don't run two systems of
  record forever).
- **Approximate distinct** by default: a documented ~0.5% error on unique counts, opt-out to `uniqExact`.
- **Eventual dedupe**: ReplacingMergeTree + insert-window set instead of a unique index; a rare, short-lived
  transient duplicate is possible before a merge (FINAL avoided for cost).

## The three chapters
1. **The numbers that forced it** — the Act-1 load report: all three ADR-0002 criteria crossed on measurements.
2. **The parity that proved it** — golden fixtures within tolerance, and reconciliation (which *caught the
   backfill/dual-write race by counting*, then went green after the overlap fix).
3. **The deletion that finished it** — PG events writes decommissioned, the table archived.

A migration you can't put three dated numbers against isn't an engineering decision; it's a preference.
See ADR-0007 for the design and the alternatives' numbers.
