# Sprint 06 — Persons & Identity Resolution

**Branch:** `sprint-06/identity` · **Size:** L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** The identity problem the SDK named in S3: anonymous browsing stitched to identified users. A distinct-id graph, `identify`/`alias` semantics, person properties (`$set`/`$set_once`), person profiles — and a merge-race arc, because identity merging under concurrency is where analytics products quietly corrupt data.

## A — Issues
1. `Person + DistinctIdMapping (the identity graph)`
2. `Consumer: identify/alias handling; person creation & merging`
3. `Person properties: $set, $set_once semantics`
4. `Person profiles UI + person-level event history`
5. `Unique-user queries resolve through persons`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(db): Person, DistinctIdMapping (distinctId → personId, unique)` | the graph is a mapping table, not graph theory — yet |
| 2 | `feat(consumer): person resolution stage — every event resolves distinctId → personId (create-on-first-sight)` | resolution is on the write path: resolve once at ingest, not at every query — the decision that makes S7+ queries sane; cached with TTL |
| 3 | `feat(consumer): identify — anonymous id + user id become one person` | merge: smaller person's mappings + properties fold into larger; events keep distinctId (immutable log!), person lookup changes |
| 4 | `test(consumer): concurrent identify from two devices → two persons for one user, FAILS` | the merge race: both resolve create-on-first-sight simultaneously |
| 5 | `fix(consumer): advisory lock on user-id key + deterministic merge order (oldest person wins)` | pg_advisory_xact_lock; deterministic winner = idempotent re-merge |
| 6 | `feat(consumer): $set / $set_once person property semantics` | LWW per property with ingest order (🔗 Tracer's LWW, different clock) |
| 7 | `feat(api+web): person profile — properties, event timeline, merged-ids list` | |
| 8 | `refactor(api): unique-user trend queries count personId not distinctId` | numbers change! the commit body shows before/after unique counts on demo data and explains why *the new numbers are the true ones* — an analytics-integrity teaching beat |
| 9 | `test(consumer): merge idempotency — replay the same identify twice, same end state` | |
| 10 | `test(e2e): browse anonymous → sign in (identify) → person timeline shows both phases` | |
| 11 | `docs: ADR-0006 identity resolution at write time; curriculum note` | |

## C — Review order
Resolution stage (2) → merge (3) → **the race arc (4→5)** → the metric change (8).

## D — Teaching comments (~10)
- resolve-at-write — 📘 the read/write tradeoff of identity: resolving at query time means every query joins the graph; resolving at write freezes history (merges only affect the future)… so merges must *also* rewrite? No — see merge commit: mapping-level fold, event rows untouched
- events immutable — 📘 the event log is never UPDATEd; identity is a *view* over it via mappings; 🔗 same append-only instinct as Meridian payroll and Tracer's log
- merge race — ⚠️ create-on-first-sight + concurrency = duplicate persons; the advisory-lock scope (user id, not table) and why deterministic winner makes retries safe
- $set_once — 📘 first-touch attribution semantics live or die on this; ordering under redelivery (dedupe first, then apply)
- metric change — 🔍 review-lens: when a correctness fix changes reported numbers, the commit must say so loudly — silent metric shifts destroy analyst trust forever; this is a *product-integrity* norm, not a code norm
- person cache — ⚠️ TTL cache of mappings on the write path: a merge must bust it or events mis-attribute for the TTL window; the invalidation publish

## E — Debate
**"Merge persons eagerly at identify vs lazily at query time?"** Lazy: no write-path locking, but every query pays graph traversal and 'how many users' becomes nondeterministic under pending merges. Eager: locking complexity once, cheap queries forever. **Resolution:** eager — analytics reads outnumber identifies 10⁴:1; pay at the rare event. Lesson: *put cost where frequency isn't.*

## F/G — Close
- Squash: `feat(sprint-06): persons & identity resolution (closes #…)`
- Deferred: cross-device probabilistic matching (never, probably — ADR says why), person deletion (→ S13 GDPR).
- Recap idea: *identity is the hardest table in analytics — resolve once, merge deterministically, never rewrite history.*
