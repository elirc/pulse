# Pulse — Product Analytics Platform (PostHog/Mixpanel Lite)

## Project Spec & 15-Sprint Upskilling Curriculum (Course 3)

**Version:** 1.0 · **Date:** 2026-07-09 · **Folder:** `pulse/` (splits into its own repo later)

---

## 1. Purpose

Third course. Same model as Meridian and Tracer (AI authors everything; junior predicts, reviews-before-reveal, runs labs, co-authors from S8).

**What this course uniquely teaches:**

- **High-throughput event ingestion** — write-optimized pipelines, backpressure, at-least-once → effective exactly-once
- **Data engineering** — columnar storage, big aggregation, funnels/retention query patterns
- **Building an SDK** — a browser library with a bundle-size budget shipped to *other people's* sites
- **Sampling & cardinality** — the statistics of "close enough, fast"
- **Experimentation** — feature flags, bucketing, significance

**Signature teaching arc:** the MVP stores events in **Postgres** on purpose. Sprint 7 load-tests it to its knees (with published numbers), then executes a live datastore migration to **ClickHouse** — dual-write, backfill, verify, cutover. "Postgres until it breaks" becomes a measured, witnessed event instead of a slogan.

> Functional clone of the PostHog/Mixpanel category (event analytics, funnels, retention, dashboards, flags, experiments) — no branding or assets. Product name: **Pulse**.

## 2. Product Overview

**Personas:** Org Admin · Analyst (builds insights/dashboards) · Developer (integrates SDK, manages flags) · **the tracked end-user** (an anonymous browser, the system's real load source).

**Core domains:** projects & API keys → SDK & ingestion → persons & identity resolution → insights (trends, funnels, retention) → dashboards & sharing → live events & web analytics → sampling & cost control → feature flags & experiments.

## 3. Tech Stack

| Layer | Choice | Teaching rationale |
|---|---|---|
| Language / repo | TypeScript strict · pnpm + Turborepo | carried |
| Web app | Next.js (analyst UI) | carried; charts per dataviz conventions |
| SDK | **`packages/sdk`** — zero-dependency browser lib, tsup build, **<6KB gz budget in CI** | building a library ≠ building an app |
| Ingestion API | Fastify, split deployable (`apps/ingest`) | hot path isolated from the app API |
| Queue | **Redis Streams + consumer groups** | Kafka concepts (offsets, consumer groups, DLQ) on cheap infra; ADR maps each concept to Kafka |
| Events store | **Postgres (S1–S6) → ClickHouse (S7+)** | the migration IS the curriculum |
| Metadata store | Postgres + Prisma (projects, users, insights, flags) | OLTP and OLAP separated — by force, in S7 |
| Jobs | BullMQ | carried |
| Load testing | k6 (used from S5 onward, not just S13) | this course measures constantly |
| CI/CD, deploy, observability | carried from prior courses; pipeline-lag metrics added | |

**Layout:** `apps/web`, `apps/api`, `apps/ingest`, `apps/consumer` (stream workers), `packages/{sdk,db,shared,config}`, `docs/{adr,curriculum,sprints,runbooks,audits}`.

## 4. Curriculum deltas vs prior courses

1. **Numbers or it didn't happen:** every pipeline sprint publishes throughput/latency measurements in the PR body. k6 appears in S4, not S13.
2. **The learner is the load:** labs use a traffic generator; several labs are "make it fall over, explain why."
3. **Correctness under duplication:** at-least-once delivery is the default assumption from S4 onward; every consumer must be idempotent and is tested for it.
4. **SDK discipline:** the SDK is treated as shipped-to-strangers code — semver, bundle budget, no globals, graceful failure when the backend is down.

### Competency additions

| Competency | Taught in |
|---|---|
| API-key auth models (public write keys vs secret keys) | S2 |
| Library/SDK engineering, bundle budgets | S3 |
| Stream processing: consumer groups, offsets, DLQ, backpressure | S4, S7, S15 |
| Identity resolution (distinct-id graphs, merges) | S6 |
| Columnar storage, partitioning, ORDER BY design | S7, S12 |
| Analytical SQL: funnels, retention, windowing | S8, S9 |
| Cache/precompute for analytics; query cost control | S10, S12 |
| Sampling statistics & confidence communication | S12 |
| GDPR deletion in append-only stores | S13 |
| Bucketing, experiments, significance testing | S14 |

## 5. Domain Model (reference)

```
Organization ─┬─ Project ─┬─ ApiKey (public write key · secret key, hashed)
              │           ├─ Event (uuid, distinctId, name, props JSON, ts, ingestedAt)   ← PG → ClickHouse
              │           ├─ Person ── DistinctIdMapping (the identity graph)
              │           ├─ Cohort (property/behavioral; materialized membership)
              │           ├─ Insight (trend | funnel | retention; query def JSON)
              │           ├─ Dashboard ── DashboardTile · ShareToken
              │           ├─ FeatureFlag ── Experiment ── ExperimentResult
              │           └─ IngestionLog / DeadLetterEvent
              └─ User (ADMIN | ANALYST | DEVELOPER)
```

## 6. Sprint map

| # | Sprint | Phase | Size | Headline |
|---|---|---|---|---|
| 1 | Foundation & walking skeleton (event → chart) | MVP | S | Fast-forward; ingest/app split from day one |
| 2 | Orgs, projects & API keys | MVP | M | Write-key vs secret-key auth; CORS for strangers |
| 3 | Browser SDK v1 | MVP | L | Batching, sendBeacon, retries, bundle budget |
| 4 | Ingestion pipeline v1 | MVP | L | Redis Streams, batched inserts, DLQ, backpressure |
| 5 | Insights v1: trends + live events → `v0.5.0` | MVP | M/L | First aggregations; deploy; k6 baseline #1 |
| 6 | Persons & identity resolution | Full | L | distinct-id graph, merge races |
| 7 | The migration: Postgres → ClickHouse | Full | XL | **Flagship:** break it publicly, dual-write, backfill, cutover |
| 8 | Funnels (dialogue format) | Full | L | Sequence matching; learner co-authors |
| 9 | Retention & cohorts | Full | M/L | Retention matrices; membership precompute |
| 10 | Dashboards, sharing & subscriptions | Full | M/L | Cached tiles, share tokens, scheduled emails |
| 11 | Live events & web analytics | Full | M/L | SSE tail, sliding-window counters |
| 12 | Sampling, cardinality & query cost | Full | L | Pre-aggregation, top-N guards, confidence UI |
| 13 | Hardening: ingestion chaos & GDPR | Full | L | Clock skew, poison pills, deletion in append-only |
| 14 | Feature flags & experiments | Full | L | Bucketing, exposure, significance, peeking |
| 15 | Production readiness → `v1.0.0` | Full | L | Pipeline observability, quota metering, stall drill |

Order of events per sprint: [docs/sprints/00-workflow.md](docs/sprints/00-workflow.md) + per-sprint playbooks.

## 7. Open questions (decide before Sprint 1)

1. ClickHouse hosting for prod (self-hosted container vs ClickHouse Cloud free tier)?
2. Traffic generator scale targets (default: 2k events/s sustained in labs)?
3. Do we dogfood — point Pulse's own SDK at Meridian/Tracer staging for real demo data?
