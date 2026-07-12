# ADR-0006 — Identity resolution at write time

**Status:** accepted (S06) · **Deciders:** Pulse course · **Revisited:** S13 (person deletion / GDPR)

## Context

Analytics sees a person through many ids: an anonymous browser id, then a logged-in user id, across devices.
"How many users?" and "show me this person's history" require collapsing those ids into one Person — the
identity problem the SDK named in S03. Two questions decide the architecture: **when** do we resolve
(read time vs write time), and **how** do we merge safely under concurrency.

## Decision

**Resolve at WRITE time.** The consumer resolves every event's `distinctId → personId` (create-on-first-sight)
and freezes `personId` onto the event row. Queries then count/group a frozen id — no graph traversal per query.

**The event log is immutable; identity is a view over it via the mapping table.** A merge changes
`DistinctIdMapping`, never event rows. So a merge fixes the FUTURE (new lookups resolve to the survivor); the
past stays exactly as recorded. We never `UPDATE` history — the same append-only instinct as the S04 stream and
every ledger.

**Merge deterministically, under a per-key lock.** `identify` folds the two persons into one; the **oldest
person wins** (deterministic → a replayed identify is idempotent). The whole merge runs under a lock keyed on
the user id (`pg_advisory_xact_lock` in prod), which serializes concurrent identifies for the same user — the
race that otherwise splits one user into two persons. Create-on-first-sight takes the lock only on the create
path (double-checked), so the hot common paths stay lock-free.

**Unique-user metrics count `personId`.** `count(distinct coalesce(personId, distinctId))` — one human on two
devices is one user. This **changed reported numbers**, and the change was announced loudly (see the S06 metric
commit); the new numbers are the true ones.

## Rationale

**Put cost where frequency isn't.** Analytics reads outnumber identifies by ~10⁴:1. Resolving at read time would
tax every query with a graph traversal and make "how many users?" nondeterministic while merges are pending.
Resolving at write pays the cost once, at the rare event, and leaves every query simple. (The S06 debate.)

**Correctness lives where the state and the contention are.** The merge race is a check-then-act on a shared id;
the fix is mutual exclusion scoped to that id, plus a deterministic winner so retries converge — the same
"at-least-once + idempotent apply" shape as S04, applied to identity.

## Consequences

- A merge must invalidate the resolver's mapping cache for moved ids, or events mis-attribute for the TTL
  window (handled by re-priming the cache on merge).
- Resolution is on the write path, so it must stay cheap: cache + double-checked locking keep it off the DB in
  the common case.
- **Deferred:** cross-device *probabilistic* matching — **declined, probably forever**: guessing that two ids
  are the same person silently corrupts "how many users?", the one number analytics must not lie about. Person
  **deletion** (right-to-be-forgotten) → S13.
- **Links:** ADR-0004 (the SDK that names the alias problem), ADR-0005 (the at-least-once pipeline this mirrors),
  the S13 GDPR work.
