# Pulse Sprint Playbooks

Execution scripts for the 15-sprint build of **Pulse** (product analytics — see [SPEC.md](../../SPEC.md)). Course 3; assumes Meridian and Tracer.

**Start here:** [00-workflow.md](00-workflow.md) — the ritual plus Pulse rules (numbers in every pipeline PR, idempotent consumers, SDK discipline, break-it labs).

| Sprint | Playbook | Headline |
|--------|----------|----------|
| 01 | [sprint-01.md](sprint-01.md) | Foundation: event → chart skeleton, ingest split |
| 02 | [sprint-02.md](sprint-02.md) | Projects & API keys (write vs secret) |
| 03 | [sprint-03.md](sprint-03.md) | Browser SDK v1 (bundle budget, batching, beacon) |
| 04 | [sprint-04.md](sprint-04.md) | Ingestion pipeline: Redis Streams, DLQ, backpressure |
| 05 | [sprint-05.md](sprint-05.md) | Trends + live events, deploy → `v0.5.0` |
| 06 | [sprint-06.md](sprint-06.md) | Persons & identity resolution |
| 07 | [sprint-07.md](sprint-07.md) | Postgres → ClickHouse migration (flagship) |
| 08 | [sprint-08.md](sprint-08.md) | Funnels (dialogue format) |
| 09 | [sprint-09.md](sprint-09.md) | Retention & cohorts |
| 10 | [sprint-10.md](sprint-10.md) | Dashboards, sharing, subscriptions |
| 11 | [sprint-11.md](sprint-11.md) | Live events & web analytics |
| 12 | [sprint-12.md](sprint-12.md) | Sampling, cardinality, query cost |
| 13 | [sprint-13.md](sprint-13.md) | Hardening: ingestion chaos & GDPR |
| 14 | [sprint-14.md](sprint-14.md) | Feature flags & experiments |
| 15 | [sprint-15.md](sprint-15.md) | Production readiness → `v1.0.0` |

**Arcs to watch:** Postgres-until-it-breaks (S1 ADR → S5 baseline → S7 public failure + migration); the duplication discipline (S4 dedupe → S6 merge races → S7 backfill idempotency → S13 chaos); the SDK as a product (S3 → S13 herd harvest → S14 flag evaluation). Ledger: [flaw-ledger.md](flaw-ledger.md).
