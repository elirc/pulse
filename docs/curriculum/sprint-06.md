# Curriculum Note — Sprint 6: Persons & Identity Resolution

Identity is the hardest table in analytics: resolve once, merge deterministically, never rewrite history.

## Learning objectives
- Choose **when** to resolve identity (write vs read) and see why write-time wins for a read-heavy system.
- Internalize **immutable log + mapping view**: merges change lookups, never history.
- Meet the **merge race** — the way analytics products quietly duplicate users — and fix it with a scoped lock
  and a deterministic winner.
- Understand why a correctness fix that **changes reported numbers** is a product event, not just a code change.

## Key concepts
- **📘 Resolve at write time; put cost where frequency isn't.** Reads outnumber identifies ~10⁴:1. Resolving at
  read time taxes every query with a graph traversal and makes "how many users?" wobble while merges pend.
  Resolve once, at the rare event, and freeze `personId` onto the row — queries stay simple counts.
- **📘 The event log is immutable; identity is a view.** A merge edits the mapping table, never event rows. So
  history is untouched and only *future* lookups change. If your instinct was "a merge must rewrite the old
  events' personId" — no: that's an `UPDATE` over the biggest table in the system, and it's unnecessary, because
  the person is resolved *through* the mapping, and the frozen personId on old rows is corrected by... nothing —
  it stays, because we resolved it correctly at write time and the merge only affects ids seen *after*. (The
  subtlety: pre-merge rows already carry the pre-merge personId; that's acceptable because the mapping makes
  both persons resolvable, and the survivor is what future queries and the profile use.)
- **⚠️ The merge race.** Create-on-first-sight + concurrency = two persons for one user. Two devices sign in at
  once, both resolve the user id, both see "no person," both create one. The fix is a lock **scoped to the user
  id** (never a global lock) plus a **deterministic winner** (oldest) so a redelivered identify converges. Same
  shape as S04's idempotency, one layer up.
- **📘 `$set` vs `$set_once`.** Last-write-wins vs first-touch. First-touch attribution (initial utm, first
  referrer) lives or dies on `$set_once` never being overwritten — including under redelivery.
- **🔍 A metric change is a product event.** When unique-users shifts because we now count `personId`, the commit
  must say so loudly and explain why the new number is the true one. Silent metric shifts destroy analyst trust
  permanently — a *product-integrity* norm, not a code norm.
- **⚠️ Cache invalidation on merge.** The resolver caches `distinctId → personId` on the write path. A merge must
  re-prime that cache for every moved id, or events mis-attribute to the deleted person for the TTL window.

## The debate, cashed
**Merge eagerly at identify vs lazily at query time?** Resolved: **eager.** Lazy avoids write-path locking but
makes every query pay graph traversal and "how many users" nondeterministic under pending merges. Eager pays the
locking complexity once, at the rare identify, and keeps queries cheap forever. *Put cost where frequency isn't.*

## Exercise questions
1. Draw the identity graph after: anon `a1` fires 3 events, then `identify(a1, u9)`, then `u9` fires 2 events on
   a new device `a2` (via another identify). How many persons, how many mappings, whose personId is on each of
   the 5+ events?
2. Two devices call `identify(_, u9)` at the same millisecond. Without the lock, what's the end state? With the
   lock keyed on `u9`, what changes — and why is the winner chosen by *age* rather than, say, which arrived
   first?
3. Why does resolving at write time mean a merge does NOT have to rewrite historical event rows? What breaks if
   you tried to resolve at read time instead?
4. Unique-users dropped after S06. Write the sentence you'd put in the changelog so an analyst trusts the new
   number instead of filing a bug.
5. `$set_once` sets `initial_referrer`. An event redelivers (at-least-once). Show why the value doesn't change,
   and what would go wrong if `$set_once` were implemented as `$set`.
6. The resolver caches mappings for 60s. A merge happens. Which events could mis-attribute, for how long, and
   what line prevents it?
