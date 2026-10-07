# Pulse

**Pulse is a course, not just a codebase.** It builds a product-analytics platform — event ingestion, an
embeddable browser SDK, persons & identity, insights (trends, funnels, retention), dashboards, live events,
sampling, feature flags & experiments — as a git-connected sequence of 15 teaching-rich sprints. Each sprint is
a Pull Request loaded with annotated code, ADRs, design-debate threads, and planted-then-harvested flaws,
designed to take a junior engineer to mid/senior.

Pulse is **Course 3** of the curriculum (Meridian → Tracer → **Pulse** → Relay → Harbor → Folio).

## The thesis

> **Numbers, or it didn't happen — and infrastructure arrives when a measured need does.**

Pulse's signature arc is the **Postgres → ClickHouse migration (Sprint 7)**: the MVP stores events in Postgres
*on purpose*, S1 writes down the numeric exit criteria, S5–S6 load-test toward them, and S7 executes a live
datastore migration (dual-write → backfill → verify → cutover) once the numbers force it. "Postgres until it
breaks" becomes a *measured, witnessed* event, not a slogan.

## What it teaches

- **High-throughput ingestion** — a hot path split from the app API; Redis Streams + consumer groups (Kafka
  concepts on cheap infra); at-least-once delivery with idempotent consumers.
- **A browser SDK** — a zero-dependency library shipped to *strangers' sites*: a **<6KB gz bundle budget** in
  CI, semver, no globals, and never throwing into the host page.
- **Data engineering** — columnar storage, big aggregations, funnel/retention/cohort query patterns.
- **The statistics of "close enough, fast"** — sampling, cardinality, query cost, experiment significance.
- **Measurement as a habit** — a traffic generator from Sprint 1; k6 from Sprint 5; every pipeline PR reports
  measured throughput/latency.

## Status

**v1.0.0 — all 15 sprints shipped.** Ingestion, SDK, identity, insights (trends/funnels/retention/cohorts), the
Postgres→ClickHouse migration, dashboards & sharing, live events, sampling & query-cost control, pipeline
hardening & GDPR, feature flags & experiments, and production readiness (observability, quotas, incident
readiness). All five planted flaws harvested. See `CHANGELOG.md`.

## Stack

pnpm + Turborepo · TypeScript strict · `apps/web` (analyst UI) · `apps/api` (Fastify) · `apps/ingest` (the hot
path, a separate deployable) · `apps/consumer` (stream workers) · `apps/jobs` (scheduled) · `packages/{sdk, db
(Prisma), shared, config, loadgen, auth, stream, insights, flags}` · Postgres → ClickHouse · Redis Streams.

CI runs **without live infra** — pure cores + in-memory fakes; DB/queue/stream wiring is verified via typecheck
+ build (`.github/workflows/ci.yml`: lint, then `turbo run typecheck test build`, then `turbo run budget`, then
the consumer chaos suite `apps/consumer/src/chaos.test.ts`; a parallel job runs gitleaks over history and a
dependency audit). The SDK bundle budget is a hard 6 KB gzipped limit (`BUDGET_BYTES = 6 * 1024` in
`packages/sdk/scripts/check-size.mjs`); the last measured size recorded for v1.0.0 was 3.1 KB gz — re-run
`pnpm turbo run budget` for the current figure. Perf numbers come from local/lab k6 runs, reported in PR bodies.

## Run it
```bash
pnpm install
docker compose up --build          # postgres + redis + clickhouse + services
pnpm dev                           # turbo run dev: web (vite) + api, ingest, consumer, jobs (tsx watch)
```
See `docs/ops/deploy.md` for staging/prod, `docs/ops/runbooks.md` for on-call, `docs/ops/backups.md` for
backup/restore.

## Docs
- `SPEC.md` — the product spec + curriculum.
- `docs/sprints/` — the 15 sprint playbooks + the ritual (`00-workflow.md`) + the flaw ledger.
- `docs/adr/` — architecture decisions (0001–0012; 0012 records staying on Redis Streams and the triggers for
  Kafka). `docs/curriculum/` — per-sprint learning notes.
- `docs/ops/` — a pipeline dashboard (`dashboards/pipeline.json`), runbooks, deploy, backups and a postmortem
  (Sprint 15). Alert rules are code, not docs: `packages/shared/src/alerts.ts` (tested in `alerts.test.ts`).
- `docs/experiments/` — the peeking simulation + methodology (Sprint 14).
- `CHANGELOG.md` — the release history, sprint by sprint.

## Where to start reading code

| You want to understand… | Start at |
| --- | --- |
| the hot ingestion path | `apps/ingest/` (separate deployable, ADR 0001) |
| stream consumers, identity, dedup, DLQ | `apps/consumer/src/` (`identity.ts`, `dlq.ts`, `reconcile.ts`, `chaos.test.ts`) |
| the Postgres -> ClickHouse migration | `apps/consumer/src/migration.ts`, `backfill.ts`, `dual-write.test.ts`; ADR 0007 |
| the browser SDK and its budget | `packages/sdk/`, `packages/sdk/scripts/check-size.mjs`; ADR 0004 |
| local infrastructure | `docker-compose.yml` (postgres 16, redis 7, clickhouse 24, plus ingest, consumer, api, jobs, web) |

**Check:** before claiming any number from this README, find the file that enforces or records it — the budget
in `check-size.mjs`, the CI steps in `ci.yml`, the sprint's measured figures in its PR body or `docs/perf/`.
