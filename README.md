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
+ build. The SDK bundle budget is CI-enforced (3.1 KB gz / 6 KB). Perf numbers come from local/lab k6 runs,
reported in PR bodies.

## Run it
```bash
pnpm install
docker compose up --build          # postgres + redis + clickhouse + services
pnpm dev                           # web + api + ingest + consumer
```
See `docs/ops/deploy.md` for staging/prod, `docs/ops/runbooks.md` for on-call, `docs/ops/backups.md` for
backup/restore.

## Docs
- `SPEC.md` — the product spec + curriculum.
- `docs/sprints/` — the 15 sprint playbooks + the ritual (`00-workflow.md`) + the flaw ledger.
- `docs/adr/` — architecture decisions (0001–0011). `docs/curriculum/` — per-sprint learning notes.
- `docs/ops/` — dashboards, alerts, runbooks, backups, postmortems (Sprint 15).
- `docs/experiments/` — the peeking simulation + methodology (Sprint 14).
- `CHANGELOG.md` — the release history, sprint by sprint.
