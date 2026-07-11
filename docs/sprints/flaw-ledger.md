# Pulse Flaw Ledger (author-private until Sprint 13 recap)

| # | Planted in | What | Where | Harvested in | Status |
|---|-----------|------|-------|--------------|--------|
| 1 | S03 | SDK retry backoff has no jitter and no cap — a backend outage ends with a synchronized thundering herd from every tab | sdk transport | S13 (chaos test recreates the herd; jitter + cap + circuit breaker) | planned |
| 2 | S04 | Enrichment (UA parse, geo) runs synchronously per event inside the consumer loop | consumer enrich step | S07 (batch enrichment during migration rework; before/after throughput) | planned |
| 3 | S04 | Ingest trusts client-supplied timestamps unconditionally | ingest validation | S13 (clock-skew chaos; server-time policy + skew clamping) | planned |
| 4 | S05 | Live events feed queries the raw events table with no index/limit discipline | live feed endpoint | S11 (replaced by stream tail) + S12 evidence | planned |
| 5 | S10 | Dashboard share tokens never expire and aren't revocable-listed | share token issue | S13 (expiry + revocation + enumeration test) | planned |

**In-PR arcs (planted and fixed inside one PR by design):**
S02 write key accepted on a read endpoint → privilege-confusion test → split key types · S04 consumer crash → duplicate inserts → event-uuid dedupe · S06 concurrent identify/alias merge race → advisory lock + deterministic merge order · S07 dual-write drift → reconciliation count check.

**Rules:** never fix a ledger flaw silently; harvesting commits quote the ledger row and flip Status.
