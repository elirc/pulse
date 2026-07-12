# ADR-0007 — ClickHouse for events; the ORDER BY is the index

**Status:** accepted (S07) · **Deciders:** Pulse course · **Supersedes:** the storage half of ADR-0002

## Context

ADR-0002 wrote exit criteria in S01; the S07 Act-1 load report shows all three crossed at 50M rows / 5k
events/s (trend p95 11.4s, unbounded ingest lag, index bloat harming the OLTP DB). The workload is
`count(distinct person)` / `count(*)` over a few columns of tens of millions of rows, filtered by arbitrary
JSONB properties — the OLAP shape. We migrate the events store off Postgres.

## Decision

**ClickHouse** for events; Postgres keeps metadata (orgs, projects, persons, insights). The events table:
`ReplacingMergeTree(ingestedAt)`, `PARTITION BY toYYYYMM(ts)`, **`ORDER BY (projectId, name, ts, uuid)`**.

### Alternatives, with numbers (we publish the loser's too)
| Option | 50M-row distinct-trend p95 | Ingest at 5k/s | Verdict |
|---|---|---|---|
| Postgres (current) | 11.4 s | lag grows | the baseline that failed |
| Postgres partitioned + rollups | ~3.1 s on *rollup-able* queries; **~9 s on arbitrary-filter distinct** | improved | doesn't fix criterion #2 for ad-hoc filters |
| TimescaleDB | ~6 s | improved | continuous aggregates share the rollup limitation |
| **ClickHouse** | **~90 ms** | 12k/s sustained | columnar reads a few columns of many rows |

Partitioning + rollups is a real, cheaper-to-operate gain — but rollups can only precompute the questions you
named in advance, and the product's superpower is *arbitrary* filters/breakdowns. The moment a user filters by a
property no rollup covers, they're scanning raw partitions again. ClickHouse makes the arbitrary case fast.

## Rationale

**Row stores read rows; column stores read columns.** Our query touches 3 columns of 50M rows; a row store
hauls whole rows off disk to read them. Columnar reads only those columns, and — because of the ORDER BY —
reads them compressed and locality-clustered. That's not a constant-factor tuning win; it changes the curve.

**The ORDER BY is the primary index, the locality, and the compression, all at once.** You get one spine.
`(projectId, name, ts)` because nearly every insight filters projectId, usually name, always a ts window; `uuid`
last so `ReplacingMergeTree` can collapse exact re-deliveries.

## Consequences

- **Dedupe is re-solved, not ported.** No unique index exists here. `ReplacingMergeTree` dedupes *eventually*
  (at merge); the consumer adds an in-memory insert-window set for the common redelivery, and queries avoid
  `FINAL`. The S04 lesson ("at-least-once needs idempotent apply") held; only the implementation changed.
- **Approximate distinct enters the course.** `uniq()` (HLL) replaces exact `count(distinct)` for scale, with
  documented error bounds and golden tests carrying a defined tolerance; `uniqExact` is available when exactness
  is worth the cost.
- **Two stores to operate** during the migration; the migration ends with a **decommission** so we don't run
  two systems of record forever (which is zero systems of record).
- **Links:** ADR-0002 (the criteria this answers), the S04 dedupe (re-solved here), baseline #1 (before) and
  baseline #2 (after).
