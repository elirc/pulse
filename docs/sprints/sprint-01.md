# Sprint 01 — Foundation: Event → Chart Skeleton

**Branch:** `sprint-01/foundation` · **Size:** S · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Fast-forward scaffold with the course's defining structural choice made on day one: ingestion is a **separate deployable** from the app API. Walking skeleton: `POST /e` → Postgres events table → a count-by-day chart.

## A — Issues
1. `Monorepo scaffold: apps/{web,api,ingest}, packages/{db,shared,config}`
2. `Walking skeleton: POST /e stores an event; web renders daily counts`
3. `CI + governance (fast-forward)`
4. `ADR-0001 split ingest deployable; ADR-0002 Postgres-first with published exit criteria`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `chore: monorepo scaffold (fast-forward, compressed)` | |
| 2 | `feat(db): Event table — uuid, projectId, distinctId, name, props jsonb, ts, ingestedAt` | plain table, deliberately naive; BRIN vs btree discussion deferred |
| 3 | `feat(ingest): POST /e — zod validation, insert, 200` | synchronous insert — *the* baseline everything gets measured against |
| 4 | `feat(api): GET /insights/daily-counts — GROUP BY day` | |
| 5 | `feat(web): shell + one line chart (dataviz conventions)` | |
| 6 | `feat(tools): traffic generator — packages/loadgen, configurable events/s` | exists from sprint 1; the course's measuring stick |
| 7 | `test: unit wiring + ingest integration test` | |
| 8 | `ci: pipelines + branch protection (fast-forward)` | |
| 9 | `docs: ADR-0001 ingest as separate deployable` | hot path isolated: different scaling, different risk, different deploy cadence |
| 10 | `docs: ADR-0002 Postgres-first — with numeric exit criteria` | **the course thesis:** stay on PG until (a) sustained ingest > X/s degrades p95, or (b) trend queries > Ys at Z rows — S7 will measure us across the line |
| 11 | `docs: curriculum note sprint 01` | |

## C — Review order
ADR-0002 (exit criteria) → ADR-0001 → the naive insert (3) → loadgen (6).

## D — Teaching comments (~8)
- ingest split — 📘 the hot path has different physics: spiky, unauthenticated-ish (write keys), latency-sensitive; never let a dashboard query and an ingest burst share a process
- naive insert — 🔍 review-lens: this synchronous insert is *correct* and will die publicly in S7; note what it doesn't do (queue, batch, dedupe) — that's the syllabus
- jsonb props — 📘 schemaless event properties: the flexibility/queryability trade; 🔗 cardinality reckoning comes in S12
- exit criteria — 📘 "we'll migrate when we need to" is procrastination without numbers; criteria written before the pain is architecture, after is excuse
- loadgen — 📘 build the measuring stick before the thing you'll measure

## E — Debate
**"Kafka/Redpanda now vs Redis Streams later vs nothing yet?"** Kafka: the real tool, heavy infra for a walking skeleton. Nothing: simplest, but S4 needs a queue regardless. **Resolution:** nothing this sprint (synchronous insert as honest baseline), Redis Streams in S4 with an ADR mapping every concept to its Kafka equivalent. Lesson: *infrastructure arrives when a measured need does — but the roadmap names it early.*

## F/G — Close
- Squash: `feat(sprint-01): foundation — event→chart skeleton, ingest split (closes #…)`
- Recap idea: *we wrote down the numbers that will force our biggest decision — S7 is a date with those numbers.*
