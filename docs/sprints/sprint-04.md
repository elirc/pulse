# Sprint 04 — Ingestion Pipeline v1

**Branch:** `sprint-04/ingestion-pipeline` · **Size:** L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** The synchronous insert dies. Redis Streams with a consumer group, batched inserts, validation/enrichment stages, a dead-letter queue, and backpressure — with the duplicate-delivery arc that installs the course's central discipline: **consumers are idempotent or they don't merge.**

## A — Issues
1. `Ingest: validate → ack fast → XADD to stream (202 semantics)`
2. `apps/consumer: consumer group, batched COPY-style inserts`
3. `Enrichment: UA parsing + geo (local mmdb)`
4. `DLQ for poison events; backpressure (429 + Retry-After)`
5. `k6 numbers: baseline vs pipeline (PR body)`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(ingest): validate + XADD + 202 — the hot path becomes enqueue-only` | p95 target <15ms; zod once, cheaply; oversized payload rejection |
| 2 | `feat(consumer): consumer group — XREADGROUP batches, XACK on success` | ADR-0005 maps Streams↔Kafka: group=consumer group, pending list≈uncommitted offsets, XAUTOCLAIM≈rebalance |
| 3 | `feat(consumer): batched inserts — N events per multi-row INSERT` | batch size vs latency measured; numbers in body |
| 4 | `feat(consumer): enrichment stage — UA parse, geo lookup` | **[flaw #2]** synchronous per-event enrichment inside the loop (harvest S7); numbers *conspicuously absent* for this stage |
| 5 | `test(consumer): kill mid-batch → restart → duplicate rows, FAILS` | at-least-once demonstrated: crash after insert, before XACK |
| 6 | `fix(consumer): idempotent inserts — unique(event uuid) + ON CONFLICT DO NOTHING` | the arc's payoff; 🔗 the S3 uuid earns its keep; "effective exactly-once = at-least-once + idempotency" |
| 7 | `feat(consumer): DLQ — malformed events to dead-letter stream with error context; replay tool` | poison pills must not block the group; XAUTOCLAIM for stuck pending entries |
| 8 | `feat(ingest): backpressure — stream depth watermark → 429 + Retry-After` | shed at the edge; 🔗 the SDK's retry handles 429… revisit flaw #1 someday |
| 9 | `test(load): k6 — sync baseline vs pipeline; sustained 2k events/s report` | ingest p95, consumer lag, insert throughput — the PR-body table |
| 10 | `feat(api): ingestion health endpoint — stream depth, consumer lag, DLQ count` | numbers become operational surface — 🔗 S15 alerts on these |
| 11 | `docs: ADR-0005 Redis Streams (Kafka concept map); curriculum note` | |

## C — Review order
Hot path (1) → consumer group + ADR map (2) → **the duplicate arc (5→6)** → DLQ (7) → the k6 table.

## D — Teaching comments (~12)
- 202 semantics — 📘 accepted ≠ processed; the contract change is the architecture change; what the SDK may now assume (nothing)
- ack-fast validation — 🔍 review-lens: what's cheap enough for the hot path (shape checks) vs what moves to the consumer (enrichment, dedupe)
- pending list — 📘 the crash-recovery story: un-acked entries are redelivered — *that's* where duplicates are born, by design
- duplicate arc — 📘 the sentence to memorize: at-least-once delivery + idempotent apply = effective exactly-once; delivery guarantees are properties of the *pair*
- ON CONFLICT — ⚠️ dedupe needs a unique index — check its size growth; TTL'd dedupe alternatives named for when the table is columnar (🔗 S7 must re-solve this!)
- DLQ — 📘 a poison event is data about your validators; DLQ with error context is a bug-report queue; replay after the fix
- backpressure — 📘 shed load where it's cheapest (the edge), signal politely (Retry-After); the alternative is OOM at the consumer
- enrichment stage — *(silent on the sync-per-event cost — flaw #2; the missing numbers are the tell for sharp readers)*

## E — Debate
**"Dedupe at ingest (before XADD) vs at consumer (before insert)?"** Ingest: earliest, but needs shared state on the hot path (a Redis check per event). Consumer: the DB's unique index is already there, batch-friendly. **Resolution:** consumer — the hot path stays stateless; duplicates in the stream are cheap, duplicates in the store are lies. Lesson: *place correctness where state already lives; keep the hot path dumb.*

## F/G — Close
- Squash: `feat(sprint-04): ingestion pipeline — streams, batching, dlq, backpressure (closes #…)`
- **Lab (break-it #1):** junior drives loadgen up until backpressure fires, then kills a consumer mid-run — writes up the recovery timeline from the health endpoint + Redis introspection.
- Ledger: flaws #2, #3 recorded (client-timestamp trust rides in commit 1's validator, unremarked).
- Recap idea: *pipelines are promises about failure: acked-fast, processed-eventually, duplicated-sometimes, lied-about-never.*
