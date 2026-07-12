# Deploy — staging & production (S15)

Pulse is four deployables + scheduled jobs. The deploy order and safety rules below come from the architecture:
ingest is the hot path (deploy it defensively), the consumer owns delivery guarantees (deploy it gracefully),
and schema changes touch two stores with different physics.

## Topology
| Service | Scales on | Notes |
|---|---|---|
| `apps/ingest` | ingest rate (429 backpressure protects it) | stateless; N replicas behind a LB; per-key rate limit is per-instance |
| `apps/consumer` | consumer lag | consumer GROUP; add replicas to drain faster; **graceful shutdown on SIGTERM** |
| `apps/api` | query load | stateless; per-project query concurrency cap is per-instance |
| `apps/web` | — | static SPA |
| `apps/jobs` | cron | cohort recompute, reports, **hourly loss reconciliation** |

## Deploy order (rolling, zero-downtime)
1. **Migrate additively first** (expand). New PG columns nullable/defaulted; new CH columns added, never
   `MODIFY` on the hot events table under load. Old and new code must coexist during the roll.
2. **Consumers** — rely on graceful shutdown: SIGTERM → finish + XACK the in-flight batch → exit, so no pending
   list is stranded and no redelivery spike hits the new replicas.
3. **Ingest** — stateless roll; a briefly-mixed fleet is fine (the stream is the contract between versions).
4. **API + web**.
5. **Contract** (remove old shapes) only after every replica is on the new code and any backfill is done.

## Smoke test after deploy (must pass before declaring success)
- Full-loop E2E vs the deployed stack: SDK → `/e` (202) → consumer → CH → a trend query returns the event.
- `GET /health` on ingest + api; `GET /ops/ingest` (lag/DLQ sane); `GET /ops/usage` (metering live).
- **Loss accounting** for the deploy window reconciles to zero — a deploy that dropped events is a failed deploy
  even if every health check is green.

## Environment
Secrets via the platform's secret store, never committed (gitleaks gate, S13). Key envs: `DATABASE_URL`,
`CLICKHOUSE_URL`, `REDIS_URL`, `READ_FROM_CH`, `SESSION_SECRET` (must be overridden in prod — ADR-0003),
`RATE_LIMIT_*`, `QUOTA_MONTHLY_ALLOWANCE`, `MAX_QUERY_*`.

## Rollback
- Code: redeploy the previous image (stateless services roll back instantly; consumers drain gracefully).
- Schema: additive migrations are backward-compatible, so a code rollback needs no schema rollback. A contract
  step is the only one-way door — never contract and deploy in the same release as the code that stops using the
  old shape.
- Data: restore per `backups.md` (PG `pg_restore`, CH `ATTACH PARTITION`).
