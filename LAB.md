# Lab (break-it #2) — Sprint 07: both engines at scale, then kill ClickHouse mid-batch

An operational exercise (no planted bugs): run the S05 query suite against **both** storage engines at 100M
rows and compare, then kill ClickHouse mid-insert-batch and report what the buffering layer did. Needs real
infra (`docker compose up` now includes `clickhouse`).

## Setup
```bash
docker compose up --build     # postgres + redis + clickhouse + services
pnpm --filter @pulse/db push  # PG metadata + the (now-archived) events table
# create the CH events table:
docker compose exec -T clickhouse clickhouse-client --database pulse < packages/db/clickhouse/schema.sql
# load ~100M events (bulk COPY into PG, then backfill to CH; or generate straight into both).
```

## Part A — same queries, both engines, 100M rows
Run the S05 k6 trend suite (and the raw `EXPLAIN ANALYZE` / CH `EXPLAIN`) against:
- Postgres (`READ_FROM_CH=false`)
- ClickHouse (`READ_FROM_CH=true`)

**Record**, per query: p95 on each engine, and the **verify** endpoint's drift (`POST /insights/trend/verify`).
Confirm counts match exactly and `uniq()` uniques are within the documented tolerance. Reproduce baseline #2's
headline (10M-row trend: PG seconds, CH tens of ms) at your 100M scale.

## Part B — kill ClickHouse mid-insert-batch
With the consumer draining at load and `DUAL_WRITE=true` (PG still truth), `docker compose kill clickhouse`
during a flush. Then answer:
1. What happened to the in-flight `BufferedColumnStore` buffer — were those rows lost, retried, or stuck? Read
   the flush path and the dual-write error handling.
2. Did the consumer keep acking the stream (PG succeeded) or stall? Why?
3. Bring ClickHouse back. Run **reconciliation** — how many rows is CH short, and which are they?
4. Now repeat with `EVENTS_PRIMARY=ch` (PG decommissioned). Kill CH mid-batch again. What's *different* about the
   failure, and why? (Hint: read `worker.ts` — the swallow vs propagate branch.)

## Done when
You can state, with numbers: the per-engine query latencies at 100M rows; exactly what the buffer did on a CH
kill under dual-write vs under CH-primary; and how reconciliation quantified the gap and how you'd close it.
