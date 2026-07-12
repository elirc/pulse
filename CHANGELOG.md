# Changelog

All notable changes, sprint by sprint. Pulse ships one squash-merged PR per sprint; this is the release history.

## v1.0.0 — 2026-07-11

The 15-sprint course is complete: a production-ready product-analytics platform. All five planted flaws harvested.

### Sprint 15 — Production readiness
- Pipeline observability: ingest rate, consumer lag, DLQ depth, insert batch timings (`assessPipeline`) + a
  committed dashboard.
- **Event-loss accounting** — accepted-in vs stored-in-CH reconciled hourly (the conscience metric, target 0).
- Sampled tracing (uuid, 1%, deterministic across stages); alerts (lag SLO, DLQ growth, loss, CH disk).
- **Quotas** — per-project monthly allowance metered from the pipeline's own accepted counts; soft banner / hard
  429. Pulse meters itself with itself.
- Graceful consumer shutdown (deploy-safe rollover); PG + CH partition-level backup/restore; incident drill
  (stall → recover → zero loss) as a CI test; blameless postmortem; runbooks.

### Sprint 14 — Feature flags & experiments
- Deterministic bucketing (FNV-1a + fmix32), local SDK evaluation with a parity test, `$flag_evaluated` exposure
  events; experiments with a required hypothesis; two-proportion z-test + CI; the peeking simulation; ADR-0011.

### Sprint 13 — Hardening: ingestion chaos & GDPR
- Harvested flaws #1 (SDK retry jitter+cap+breaker), #3 (server-authoritative timestamps), #5 (share-token
  expiry+revocation). Chaos suite as CI; per-key rate limits; PII scrubbing; **verified GDPR deletion**.

### Sprint 12 — Sampling, cardinality & query cost
- Daily rollups; transparent routing (parity-gated); cardinality guard; query sampling with confidence intervals
  ("~12,400 ±3%"); per-project query concurrency + cost guards. ADR-0010.

### Sprint 11 — Live events & web analytics
- Harvested flaw #4 (raw-table poll → SSE tail over a dedicated group); sessions at ingest; "online now". ADR-0009.

### Sprint 10 — Dashboards, sharing & scheduled reports
- Dashboards, tile result cache (single-flight stampede defense), share tokens, scheduled reports (`apps/jobs`).

### Sprint 09 — Retention & cohorts
- Retention grids; one cohort AST (property live / behavioral materialized). ADR-0008.

### Sprint 08 — Funnels
- Naive oracle → single-pass state machine → ClickHouse windowFunnel, parity-pinned.

### Sprint 07 — Postgres → ClickHouse migration (flagship)
- Dual-write → backfill → verify → cutover → decommission; harvested flaw #2 (batch enrichment). ADR-0007.

### Sprint 06 — Identity resolution
- Write-time person resolution; identify/merge with advisory-lock race fix. ADR-0006.

### Sprint 05 — Insights (trends)
- Closed-AST query language → in-memory oracle + parameterized SQL compiler; planted flaw #4 (live feed).

### Sprint 04 — Streaming ingestion
- Enqueue-only ingest (202 + backpressure); Redis Streams consumer; idempotent inserts; planted flaws #2, #3. ADR-0005.

### Sprint 03 — The browser SDK
- Zero-dep SDK under a <6KB budget; batching, beacons, retries; planted flaw #1.

### Sprint 02 — Auth & API keys
- Audience-scoped key model (write/secret); cached write-key auth. ADR-0003.

### Sprint 01 — Foundation
- Monorepo walking skeleton; the traffic generator; ADR-0001 (ingest as a separate deployable) + ADR-0002
  (Postgres-first with numeric exit criteria).

### v0.5.0 — MVP (after Sprint 05)
The first coherent product: SDK → ingest → consumer → Postgres → trends in the analyst UI.
