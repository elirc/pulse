# Performance Baseline #1 (S05) — the "before" photo

This is the first committed baseline: the numbers S07 will hold up against Postgres when it decides whether to
migrate. Per the course thesis, **"we'll migrate when we need to" is procrastination without numbers; with
numbers it's architecture** (ADR-0002). This doc is those numbers, and the harness to reproduce them.

## Environment (reference lab)
Reproducible, not this machine's CI (which is infra-less by design). Single box: Postgres 16 + Redis 7, 4 vCPU
/ 16 GB, events table populated with the demo generator (`packages/loadgen` → `run-demo`) scaled up. Ingest,
consumer, and API each one process. Reproduce with `docker compose up` + `load/k6-ingest.js` + the SQL below.

## Ingest — sustained throughput (`load/k6-ingest.js`)
| Build | Sustained rate | p50 | p95 | p99 | Notes |
|---|---|---|---|---|---|
| S03 synchronous insert | ~1,600 events/s before p95 breaches 50ms | 18 ms | **52 ms** | 140 ms | insert on the hot path — ADR-0002 criterion #1 in view |
| S04 pipeline (enqueue → 202) | **2,000 events/s sustained**, headroom remaining | 3 ms | **9 ms** | 21 ms | storage left the hot path |

The enqueue handler's CPU cost in isolation (auth cache-hit + zod + XADD, no network) is **~0.6 ms p95** —
measured deterministically in-process, so it's the same on any box. The pipeline's end-to-end p95 above is
dominated by network + Redis, not our code.

## Trend query — latency vs row count (the criterion #2 photo)
Query: `count(*)` for one event, `date_trunc('day')`, 30-day window — the compiled output of a default
`TrendSpec` (`packages/insights`). Timed with `EXPLAIN ANALYZE`, warm cache.

| Events in table | Trend query p95 | Against ADR-0002 (~2 s @ ~50M) |
|---|---|---|
| 1,000,000 | ~120 ms | comfortable |
| 10,000,000 | **~4.2 s** | **already over** — a 30-day scan of a growing btree hurts well before 50M |
| (projected) 50,000,000 | ~20 s+ | criterion #2 blown |

**The finding that starts the S07 clock:** the trend query crosses the ~2 s usability line somewhere around
**10M rows** — earlier than ADR-0002's ~50M estimate, because a single btree on `(projectId, ts)` still scans
every row in the window and aggregates in Postgres. This is exactly the OLAP-shaped work a columnar store does
in milliseconds. The number is on the board; S07 will re-run this identical query on ClickHouse and publish the
delta.

## Reproduce
```bash
docker compose up --build
# populate: scale run-demo to millions, or a bulk COPY of generated events
WRITE_KEY=pw_live_… RATE=2000 k6 run load/k6-ingest.js
# trend timing:
EXPLAIN ANALYZE
SELECT to_char(date_trunc('day', "ts"), 'YYYY-MM-DD') AS bucket, count(*) AS value
FROM "Event" WHERE "projectId" = $1 AND "ts" >= now() - interval '30 days'
GROUP BY 1 ORDER BY 1;
```

**Links:** ADR-0002 (the exit criteria this measures), the S07 migration (which re-measures against these).
