# Sprint 13 — Hardening: Ingestion Chaos & GDPR

**Branch:** `sprint-13/hardening` · **Size:** L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Audit-first sweep with the pipeline as the attack surface: clock-skew and duplication chaos, the SDK thundering-herd harvest, write-key abuse controls, PII scrubbing, and the unique lesson — **GDPR deletion in an append-only columnar store**. The learner runs the audit tooling and drafts the findings.

## A — Setup (audit before code)
Learner runs: chaos harness against the pipeline (dup/reorder/skewed events via loadgen), an SDK outage simulation (backend 503 for 10 min, 200 tabs), write-key abuse probe, PII grep over event samples and logs, `pnpm audit`/gitleaks, share-token probe. Findings doc `docs/audits/sprint-13-audit.md` = commit 1 (learner-drafted, AI-annotated).

## B — Commits (one finding per commit)
| # | Commit | Notes |
|---|--------|------|
| 1 | `docs: sprint-13 audit — P1..P4 findings with evidence` | |
| 2 | `fix(sdk): retry jitter + cap + circuit breaker (P1)` | **harvests flaw #1**; the outage sim graph: recovery spike 40× steady-state before, 1.3× after; SDK minor version bump — semver in practice |
| 3 | `fix(ingest): timestamp policy — server ingestedAt authoritative; client ts clamped to ±48h skew window (P1)` | **harvests flaw #3**; chaos evidence: events "from 2031" and "from 1970" polluting buckets; clamped events flagged with `$ts_clamped` |
| 4 | `test(pipeline): chaos suite — dup/reorder/skew as permanent CI stage (P1)` | the S4 idempotency discipline, now continuously enforced |
| 5 | `security(ingest): per-key rate limits + burst budgets; abuse observability (P2)` | closes S2's deferred issue; token bucket per write key (🔗 Tracer S13's bucket, new tenancy shape) |
| 6 | `security(api): share-token expiry + revocation list + enumeration monitoring (P2)` | **harvests flaw #5** |
| 7 | `feat(api): PII scrubbing rules — property denylist/hash rules applied at ingest; log redaction audit (P2)` | scrub before storage: what never lands can never leak; write-key-in-URL (S3 beacon) log redaction verified by test |
| 8 | `feat(api): GDPR deletion — person delete API: metadata hard-delete + CH lightweight deletes by distinctIds, async with completion tracking (P1)` | deletion in append-only: mutations are async and expensive — batched, scheduled, verified by count-to-zero check; deletion-request ledger for compliance evidence |
| 9 | `test(api): deletion completeness — seeded person deleted → zero rows across events, persons, cohorts, caches` | caches! the tile cache (S10) can serve a deleted person's data until TTL — flush on delete |
| 10 | `security(ci): gitleaks + dependency gates (P3, fast-forward)` | |
| 11 | `docs: threat model — the ingestion pipeline + data-subject rights; curriculum note` | |

## C — Review order
Audit doc → herd fix with the graph (2) → timestamp policy (3) → **GDPR deletion (8–9)** — the material no other course has.

## D — Teaching comments (~10)
- herd graph — 📘 synchronized retries are self-inflicted DDoS; jitter decorrelates, caps bound, breakers stop the bleeding; 🔗 ledger quote — planted in S3, silent for 10 sprints
- skew clamping — 📘 client clocks are attacker-controlled *and* innocently wrong; policy: trust-but-clamp, flag the clamped; analytics correctness is a time-trust question
- chaos as CI — 🔗 Tracer S13 fuzzed convergence; Pulse fuzzes the pipeline — every course's crown invariant gets a permanent adversary
- scrub-at-ingest — 📘 data you don't store is compliance you don't need; the denylist/hash decision per property class
- lightweight deletes — 📘 append-only stores make deletion a *background mutation*, not a row op; cost, scheduling, and the verification obligation
- deletion ledger — 🔍 review-lens: compliance features need evidence trails — "we deleted it" must be provable months later
- cache completeness — ⚠️ deletion sweeps must enumerate *every* copy: store, caches, cohort materializations, DLQ — the deletion test is a data-inventory audit in disguise

## E — Debate
**"GDPR delete: hard mutation vs crypto-shredding (per-person key, drop the key)?"** Crypto-shred: instant, elegant — but requires per-person encryption designed in from day one, complicates every query. Mutation: slower, works retroactively. **Resolution:** mutations now; crypto-shredding documented as the design you choose *before* building, not after — an honest "we'd do this differently at greenfield" ADR note. Lesson: *some architectures are only available in the past; record the ones you passed on.*

## F/G — Close
- Squash: `fix(sprint-13): pipeline hardening, abuse controls, gdpr deletion (closes #…)`
- **Recap reveals the flaw ledger** (Pulse edition).
- **Lab (break-it #4):** junior replays the outage sim against the fixed SDK and writes the before/after comparison; then runs a deletion and hunts for any surviving copy.
- Ledger: flaws #1, #3, #5 closed — fully harvested.
- Recap idea: *pipelines are hardened against three adversaries — the network, the clock, and the law.*
