# Sprint 15 — Production Readiness → v1.0.0

**Branch:** `sprint-15/production-readiness` · **Size:** L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Operate a data pipeline: lag/throughput/DLQ as first-class dashboards, event-loss accounting, quota metering (the analytics product bills by its own medium), a consumer-stall incident drill, backup/restore for two datastores, and the v1.0 release with course retrospective.

## A — Issues
1. `Pipeline observability: lag, throughput, DLQ depth, consumer health, loss accounting`
2. `Alerting: lag SLO, DLQ growth, ingest error rate, disk headroom (CH)`
3. `Quotas & metering: per-project event allowances, usage dashboard, soft/hard limits`
4. `Ops: graceful consumer shutdown, CH + PG backup/restore drill, deploy safety for schema changes`
5. `Incident drill: stalled consumer → backlog → recovery; runbooks; v1.0.0`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(obs): pipeline metrics — ingest rate, consumer lag (per group), DLQ depth, insert batch timings` | the four numbers that *are* the product's health; dashboard JSON committed |
| 2 | `feat(obs): event-loss accounting — counted in (ingest) vs counted stored (CH) reconciled hourly` | an analytics product that loses events silently is defective merchandise; the reconciliation job publishes a loss metric (target: 0, alarmed at >0.01%) |
| 3 | `feat(obs): tracing — event uuid traced ingest → stream → consumer → insert batch` | 🔗 the uuid's final job; sampled tracing (1%) — tracing every event would out-volume the events |
| 4 | `feat(api): quotas — per-project monthly event allowance, metering from the pipeline's own counts, soft-limit banner / hard-limit 429` | dogfood completo: Pulse meters itself with itself |
| 5 | `feat(consumer): graceful shutdown — finish batch, XACK, deregister; deploy-safe consumer rollover` | pending-list discipline on SIGTERM (🔗 the S4 crash story, now voluntary and clean) |
| 6 | `feat(ops): backups — PG (metadata) + CH (partition-level) with tested restore on staging` | two stores, two restore procedures, one drill; CH partition restore ≠ pg_restore — documented side by side |
| 7 | `feat(obs): alerts — lag SLO burn, DLQ growth rate, loss metric, CH disk headroom` | |
| 8 | `test(drill): incident — stall the consumer group on staging under loadgen traffic` | executed for real: backlog grows, alert fires (lag SLO), runbook followed: diagnose (pending list) → scale consumers → drain → verify zero loss via accounting |
| 9 | `docs: postmortem — consumer stall (blameless); action items as issues` | finding: backpressure protected ingest but nothing alerted on *the SDK's* queue growth client-side — telemetry gap filed |
| 10 | `docs: runbooks — lag, DLQ triage+replay, stalled group, CH disk pressure, restore, key compromise` | |
| 11 | `chore(release): changelog, staging/prod docs, README refresh` | |
| 12 | `docs: course retrospective — the migration arc reviewed, discipline tally (idempotency count), v2 ideas (Kafka, session replay, warehouse export)` | |

## C — Review order
Loss accounting (2) — the course's conscience → quota dogfooding (4) → the drill story (8→9).

## D — Teaching comments (~9)
- loss accounting — 📘 pipelines need double-entry bookkeeping: in-counts vs stored-counts, reconciled, alarmed; "we think we got everything" is not a number
- sampled tracing — 📘 observability at data-volume: sample traces, count everything; which questions need which (⚠️ debugging one lost event needs the *accounting*, not a trace you probably didn't sample)
- self-metering — 🔍 review-lens: billing from the same pipeline you sell creates a conflict-of-interest bug class — meter from ingest-accepted counts (customer-visible), not stored counts (post-loss)
- graceful rollover — 🔗 S4's crash-recovery pending-list story, now the *deploy* story; systems that survive failure deploy for free (Tracer S15 said the same about reconnects — cross-course law)
- partition-level restore — 📘 columnar backup physics: partitions as restore units; the staging drill evidence linked
- drill finding — 📘 every drill should find a telemetry gap; a drill that finds nothing was rehearsed, not run

## E — Debate
**"Move to Kafka for v2?"** The Streams setup held 12k/s with room; Kafka buys ecosystem (connectors, warehouse export) and retention semantics, costs ops weight. **Resolution:** stay, with the ADR listing the *specific* v2 features that would flip it (warehouse export, >7-day replay windows) — the S1 concept-map ADR means the team already speaks Kafka. Lesson: *the migration you prepared for and didn't need is preparation, not waste.*

## F/G — Close & Release
- Squash: `feat(sprint-15): pipeline observability, quotas, incident readiness (closes #…)`
- **Release sequence:** merge → deploy → smoke (full-loop E2E vs prod) → tag **`v1.0.0`** → GitHub Release → recorded demo (loadgen live on the dashboard) → close milestone.
- Final discussion: **course retro** — the Postgres→ClickHouse arc end-to-end; the idempotency tally (count the places: SDK uuid, consumer insert, merge, backfill, exposure dedupe…); learner's "what I'd build differently"; pointer to course 4 (Relay).
- Recap idea: *a pipeline in production is a promise with a ledger — count what came in, count what you kept, and alarm on the difference.*
