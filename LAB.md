# Lab (break-it #1) — Sprint 04: drive the pipeline until it bends

Unlike the S03 lab, there are no planted bugs here. This is an **operational** exercise: push the ingestion
pipeline until backpressure fires, kill a consumer mid-flight, and reconstruct the recovery from the outside —
using only `GET /ops/ingest` and Redis introspection, the way you'd have to in an incident.

## Setup (real infra — this doesn't run in CI)
```bash
# 1. Redis + Postgres up (docker or local). Set DATABASE_URL, REDIS_URL.
pnpm --filter @pulse/db push          # create the events table
# 2. Three terminals:
pnpm --filter @pulse/ingest dev       # :3002  POST /e → 202
pnpm --filter @pulse/consumer dev     # drains the stream
pnpm --filter @pulse/api dev          # :3001  GET /ops/ingest
# 3. A project + write key (issue one via the API, or seed one).
```

## Part A — trip backpressure
Drive the loadgen (or k6) at a rate the consumer can't keep up with (throttle the consumer with a tiny
`BATCH_SIZE`, or just outrun it):
```bash
WRITE_KEY=pw_live_… RATE=5000 k6 run load/k6-ingest.js
```
Poll `GET /ops/ingest` while it runs. **Record:** at what `streamDepth` do you start seeing `429`s? Match that
against `INGEST_MAX_DEPTH`. Confirm the 429 carries `Retry-After`.

## Part B — kill a consumer mid-run
While load is flowing and the consumer is behind, `Ctrl-C` (or `kill -9`) the consumer process. Immediately:
```bash
redis-cli XPENDING pulse:events inserters          # entries delivered-but-unacked at the moment of death
redis-cli XLEN pulse:events                          # total backlog
```
Restart the consumer. Watch it **drain pending first**, then new work.

## Write up the recovery timeline
Answer, with numbers from your run:
1. How many entries were **pending** at the instant the consumer died? Where did they come from?
2. On restart, in what order did the consumer process work, and why that order?
3. Query the events table: **did any event get inserted twice?** Prove *why not* (which column, which clause).
4. Reconcile: `events inserted` vs `events sent by loadgen` vs `DLQ count`. Do they add up? If not, where did
   the difference go, and is it loss or in-flight?

## Done when
You can tell the recovery story as a timeline — depth rising, 429s shedding, consumer death, pending redelivery,
idempotent re-insert — backed by the numbers you captured from `/ops/ingest` and `redis-cli`.
