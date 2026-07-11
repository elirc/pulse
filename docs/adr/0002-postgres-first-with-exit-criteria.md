# ADR-0002 — Postgres-first for events, with numeric exit criteria

**Status:** accepted (S01) · **Deciders:** Pulse course · **Revisited:** S07 (the migration)

## Context

Pulse is an event-analytics product; at scale the events store is an **OLAP** problem that columnar engines
(ClickHouse, etc.) are built for. The temptation is to reach for ClickHouse on day one. This ADR records the
opposite decision — **start on Postgres** — and, crucially, writes down *the exact numbers at which that
decision expires*, so the eventual migration is a measured, witnessed event rather than a slogan.

## Decision

Store events in a single naive **Postgres** table (`Event`) through S06. This is the honest baseline: a
synchronous insert on the hot path and a `GROUP BY` for trends. It is *correct*, it is simple to operate, and
it lets us build the entire product surface (SDK, ingestion, persons, insights) before paying columnar
complexity.

**We stay on Postgres until a measured threshold is crossed. The exit criteria, written now, before the pain:**

1. **Ingest pressure:** sustained ingest above **~2,000 events/sec** drives insert p95 above **50 ms** (the hot
   path can't keep up without batching/queueing — some of which S04 adds), **or**
2. **Query pain:** a trends/funnel query over **> ~50M events** exceeds **~2 s** p95 (the analyst experience
   degrades past usable), **or**
3. **Operational:** the events table dominates DB size/vacuum/backup such that OLTP metadata (projects, users,
   flags) is collaterally harmed.

When S07 arrives, the traffic generator + k6 will drive Pulse **across** these lines under witness, publish the
numbers, and *then* migrate the events store to ClickHouse (dual-write → backfill → verify → cutover), leaving
metadata in Postgres.

## Rationale

*"We'll migrate when we need to" is procrastination without numbers; the same sentence with numbers attached is
architecture.* Criteria written **before** the pain are a plan; criteria invented **after** are an excuse. By
committing the thresholds in S01, S07 becomes a *date with these numbers* — a measurement, not an argument.

## Consequences

- The `Event` table is deliberately under-optimized (a single btree on `(projectId, ts)`; no partitioning, no
  BRIN, no columnar layout). Optimizing it now would blunt the S07 lesson.
- Every pipeline PR from here reports measured throughput/latency, so we can see ourselves approaching the
  lines rather than discovering we crossed them from an outage.
- **Links:** ADR-0001 (ingest split); the S07 migration flagship; the loadgen (`packages/loadgen`) that
  produces the numbers.
