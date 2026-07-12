# Pulse Flaw Ledger (author-private until Sprint 13 recap)

| # | Planted in | What | Where | Harvested in | Status |
|---|-----------|------|-------|--------------|--------|
| 1 | S03 | SDK retry backoff has no jitter and no cap — a backend outage ends with a synchronized thundering herd from every tab | sdk transport | S13 (chaos test recreates the herd; jitter + cap + circuit breaker) | **HARVESTED S13** — `withRetry` now uses full jitter over a capped exponential ceiling behind a `CircuitBreaker`; recovery spike ~40× → ~1.3× steady state. SDK 0.1.0 → 0.2.0. |
| 2 | S04 | Enrichment (UA parse, geo) runs synchronously per event inside the consumer loop | consumer enrich step | S07 (batch enrichment during migration rework; before/after throughput) | **HARVESTED S07** — `batchEnrich` memoizes the parse per distinct UA/ip across the batch; per-event → vectorized. |
| 3 | S04 | Ingest trusts client-supplied timestamps unconditionally | ingest validation | S13 (clock-skew chaos; server-time policy + skew clamping) | **HARVESTED S13** — `resolveEventTime` makes server `ingestedAt` authoritative; client ts trusted only within ±48h, else clamped to the boundary and flagged `$ts_clamped`. Chaos suite enforces it in CI. |
| 4 | S05 | Live events feed queries the raw events table with no index/limit discipline | live feed endpoint | S11 (replaced by stream tail) + S12 evidence | **HARVESTED S11** — `/events/live` raw-table poll deleted; replaced by the SSE tail over a dedicated fan-out consumer group (off the storage path). |
| 5 | S10 | Dashboard share tokens never expire and aren't revocable-listed | share token issue | S13 (expiry + revocation + enumeration test) | **HARVESTED S13** — tokens carry `expiresAt` (default 90d) + `revokedAt`; `evaluateShareToken` kills revoked/expired links; `EnumerationMonitor` flags prefix-scanning; DELETE revoke endpoint. |

**In-PR arcs (planted and fixed inside one PR by design):**
S02 write key accepted on a read endpoint → privilege-confusion test → split key types · S04 consumer crash → duplicate inserts → event-uuid dedupe · S06 concurrent identify/alias merge race → advisory lock + deterministic merge order · S07 dual-write drift → reconciliation count check.

**Rules:** never fix a ledger flaw silently; harvesting commits quote the ledger row and flip Status.

**Status @ S13 recap: ALL FIVE FLAWS HARVESTED.** #2 (S07), #4 (S11), #1/#3/#5 (S13). Each was planted silently
(no ADR/comment hint — only this author-private ledger), lived across multiple sprints as real code a learner
could find, and was harvested by a commit that quotes its row. The lesson of the ledger itself: *a codebase
carries load-bearing decisions that were wrong; the senior skill is finding them before an incident does, and
the discipline is fixing them where they live — not papering over them.*
