# Threat model — the ingestion pipeline & data-subject rights (S13)

A focused threat model for the surfaces S13 hardened. The framing that organizes it: an analytics pipeline is
attacked by **three adversaries — the network, the clock, and the law.** Each column below is one of them.

## Assets
- **The event stream's integrity** — counts, funnels, retention are only as honest as the events behind them.
- **The pipeline's availability** — ingest and the query cluster staying up under load and abuse.
- **Personal data** — every event may carry PII; we are a data *processor* with erasure obligations.
- **Credentials** — write keys (SDK) and share tokens (public dashboards).

## Adversary 1 — the network (availability & abuse)

| Threat | Vector | Mitigation (commit) |
|---|---|---|
| Thundering-herd on recovery | Every SDK tab retries in lockstep after an outage | Jittered + capped backoff behind a circuit breaker (2) — recovery spike ~40× → ~1.3× |
| Pipeline flooding | One compromised/buggy write key at 5k evt/s | Per-key token bucket, 429 + Retry-After, abuse observability (5) |
| Cluster starvation | One tenant's heavy queries | (S12) per-project query concurrency cap + `max_execution_time` |
| Backpressure collapse | Consumer falls behind, stream grows unbounded | (S04) edge shedding at a depth watermark |

**Stance:** shed and fail *fast and fairly*. Every limit is per-tenant, so abuse is self-contained; every rejection
is a polite retryable 429, never a silent drop.

## Adversary 2 — the clock (integrity)

| Threat | Vector | Mitigation (commit) |
|---|---|---|
| Timestamp forgery / skew | Client sends `ts` from 2031 or 1970 (malicious or a dead battery) | Server `ingestedAt` authoritative; client ts clamped to ±48h, flagged `$ts_clamped` (3) |
| Duplicate/replayed events | At-least-once delivery, redelivered batches | (S04) client-minted uuid + `ON CONFLICT DO NOTHING`; enforced by the chaos suite (4) |
| Reordering | Out-of-order delivery | Order-independent apply, asserted by the chaos suite (4) |

**Stance:** trust-but-clamp, and make the crown invariants (idempotency, time-trust) a *permanent CI adversary*
so a regression fails the build, not production.

## Adversary 3 — the law (privacy & data-subject rights)

| Threat | Vector | Mitigation (commit) |
|---|---|---|
| PII over-collection | Arbitrary event `props`, key in beacon URL | Scrub-at-ingest (deny/hash) + log redaction (7) — what never lands can't leak |
| Right-to-erasure gap (GDPR Art. 17) | No verified deletion path across an append-only store | Person-delete sweep across every store + count-to-zero verify + ledger (8, 9) |
| Immortal public links | Share tokens with no expiry/revocation | Expiry (90d) + revocation + enumeration monitor (6) |
| Secret leakage | Committed credential, vuln dependency | gitleaks + `pnpm audit` CI gates (10) |

**Stance:** minimize what you hold, and be able to *prove* you deleted it. Deletion is a data-inventory audit —
events, metadata, cohort materializations, **and caches** — with the ledger as compliance evidence.

## Residual risks / accepted
- **Per-instance guards.** The rate limiter and query cap are in-memory per replica; behind N replicas the
  effective limit is N×. Accepted as *guardrails*, not billing quotas — a global quota would need shared Redis.
- **Deletion latency.** ClickHouse lightweight deletes are async background mutations; the ledger tracks the gap
  and the verify step gates completion. A crypto-shredding design would delete instantly but must be chosen at
  greenfield (see the S13 debate + ADR note).
- **`$ts_clamped` events still count.** Clamped events land at the boundary rather than being dropped — a
  deliberate choice (don't lose data), made analyzable by the flag.

## The debate this raised — hard mutation vs. crypto-shredding
Recorded with the S13 curriculum note: mutations work retroactively and were the only option here; crypto-
shredding (per-person key, drop the key to erase) is instant and elegant but must be designed in *before*
building — it complicates every query and can't be retrofitted. *Some architectures are only available in the
past; record the ones you passed on.*
