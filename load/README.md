# Load tests

Not part of CI (which is DB-less / Redis-less by design). These run on a lab box with real Redis + Postgres and
produce the numbers reported in pipeline PR bodies — the discipline is **numbers, or it didn't happen**.

## k6 — ingest hot path
```bash
# Pipeline (S04): run ingest with Redis, and a consumer draining the stream.
WRITE_KEY=pw_live_… INGEST_URL=http://localhost:3002 RATE=2000 k6 run load/k6-ingest.js
```
Report `http_req_duration` p95 and the `checks` pass rate. Compare against the S03 synchronous build (a
`git checkout` of the pre-S04 ingest pointed at Postgres) for the baseline column.

## What to watch beyond ingest latency
- **Consumer lag** and **stream depth** (`GET /ops/ingest` on the app API — S04) — is the consumer keeping up?
- **DLQ count** — are poison events accumulating?
- **Insert throughput** at a couple of `BATCH_SIZE` settings — the batch-size/latency dial.
