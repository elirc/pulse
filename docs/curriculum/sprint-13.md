# Curriculum Note — Sprint 13: Hardening — Ingestion Chaos & GDPR

The audit-first hardening sprint, and the **flaw-ledger reveal**. One framing carries the whole sprint: an
analytics pipeline is hardened against **three adversaries — the network, the clock, and the law.** This is also
where the three remaining planted flaws (#1, #3, #5) are harvested — each planted *silently* sprints ago, lived
as real code a learner could find, and is now fixed where it lives.

## Learning objectives
- Run an audit and let *findings* drive commits — one finding, one fix, cited.
- Harvest the thundering-herd (#1), the trusted clock (#3), and immortal share tokens (#5).
- Build the material no other course has: **verified GDPR deletion in an append-only columnar store.**
- See a deletion feature for what it is — a **data-inventory audit**, caches included.

## The flaw ledger, revealed
| # | Planted | The wrong decision | Harvested |
|---|---|---|---|
| 1 | S03 | SDK retry with no jitter/cap → recovery herd | **S13** — jitter + cap + circuit breaker |
| 2 | S04 | Per-event sync enrichment in the consumer loop | S07 — batch/vectorize |
| 3 | S04 | Ingest trusts client timestamps | **S13** — server-authoritative + ±48h clamp |
| 4 | S05 | Live feed polls the raw events table | S11 — SSE tail off a dedicated group |
| 5 | S10 | Share tokens never expire/revoke | **S13** — expiry + revocation + enum monitor |

*The lesson of the ledger itself: a real codebase carries load-bearing decisions that were wrong. The senior
skill is finding them before an incident does; the discipline is fixing them where they live.*

## Key concepts
- **📘 Synchronized retries are a self-inflicted DDoS.** The outage's second victim is the recovery. Jitter
  *decorrelates* clients (full jitter = `random · ceil`), a cap *bounds* the wait, and a circuit breaker means a
  still-down backend sees ONE probe, not a flood from every tab. 🔗 Flaw #1 sat silent for ten sprints — this is
  what "planted, then harvested" feels like from the inside.
- **📘 Analytics correctness is a time-trust question.** The client clock is *both* attacker-controlled and
  innocently wrong. Policy: **trust-but-clamp** — server `ingestedAt` is the anchor, a client ts within ±48h is
  kept, anything else is pulled to the boundary and *flagged* (`$ts_clamped`) so the distortion is visible, not
  silent. Don't drop the data; label it.
- **🔗 Fuzz your crown invariant, forever.** Tracer fuzzed CRDT convergence; Pulse fuzzes the pipeline —
  duplicate/reorder/skew as a *permanent* CI adversary. Every course makes its most important invariant a
  standing test, not a one-time demo.
- **📘 The cheapest compliance is data you never store.** Scrub-at-ingest: DENY drops secrets, HASH
  pseudonymizes contact identifiers (still joinable, no longer readable). What never lands can't leak, never needs
  deleting, never shows up in a breach. (And keep the write key out of the access log.)
- **📘 Deletion in an append-only store is a background mutation, not a row op.** ClickHouse lightweight deletes
  are cheap to *issue*, async to *apply* — so deletion is scheduled, batched, and comes with a **verification
  obligation**: you haven't deleted anything until count-to-zero proves it. An unverified deletion is marked
  FAILED.
- **⚠️ A deletion sweep must enumerate EVERY copy.** Events, Postgres metadata, cohort materializations, and —
  the trap — the **tile cache** (S10), which serves a deleted person until TTL. The deletion test is a
  data-inventory audit in disguise; when you add a store, you extend the sweep *and* the test.
- **🔍 Compliance features need evidence trails.** "We deleted it" isn't a compliance answer; a **ledger** row
  with the outcome, provable months later, is. Same shape as the deletion-request audit trail regulators expect.
- **📘 A public link is a credential.** Share tokens expire and get revoked, like keys. And an identifiable
  prefix means enumeration is *observable* — a monitor that raises the alarm without denying a legitimate 404.

## The debate, cashed
**GDPR delete: hard mutation vs. crypto-shredding (per-person key, drop the key)?** Crypto-shred is instant and
elegant but requires per-person encryption designed in from **day one** and complicates every query. Mutation is
slower but works retroactively — the only option available to a system that didn't plan for shredding.
**Resolution:** mutations now; crypto-shredding recorded as the design you'd choose *before* building, in an
honest "we'd do this differently at greenfield" note. *Some architectures are only available in the past; record
the ones you passed on.*

## Exercise questions
1. With no jitter, why do 200 tabs hit the backend at the *same instant* on recovery? Show why full jitter fixes
   it and what the circuit breaker adds *on top of* jitter.
2. An event arrives with `ts` = year 2031. Trace what the pipeline stores, and what a daily-trend query shows
   for 2031 afterward. Why clamp-and-flag instead of drop?
3. The chaos suite is a permanent CI stage. Name the three invariants it asserts and, for each, the S-sprint that
   introduced the behavior it guards.
4. A property named `email` arrives. What does scrub-at-ingest do with it, and why hash rather than drop? Now
   `password` — why drop rather than hash?
5. You delete person `alice`. List every store that must be swept, and explain why the *cache* is the one people
   forget. What marks the deletion FAILED?
6. Contrast hard-mutation deletion with crypto-shredding. Why can't you switch to shredding after launch, and
   what would you have had to build in S06/S07 to make it possible?
