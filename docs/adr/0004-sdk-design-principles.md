# ADR-0004 — Browser SDK design principles

**Status:** accepted (S03) · **Deciders:** Pulse course · **Revisited:** S13 (retry hardening), S06 (identity/alias)

## Context

`@pulse/sdk` runs on pages we do not own, do not test, and cannot update on anyone's schedule. It shares a
global scope with a customer's own code, their other vendors' scripts, ad blockers, private-mode browsers, and
flaky networks. A library in that position is an app with a thousand hostile deploy environments. These
principles are the contract that makes it safe to paste in.

## Decision

1. **Never break the host page.** Every public entry point runs inside a never-throw boundary (`guard`). Errors
   are swallowed and optionally reported via `onError` — and the reporting is itself wrapped, so a broken
   reporter can't re-break the page. A bug in analytics must never take down checkout.
2. **Zero runtime dependencies, under a hard bundle budget.** The gzipped script-tag build must stay **< 6KB**,
   enforced in CI (`scripts/check-size.mjs`). Every dependency and every abstraction is a negotiation against
   that number. (Currently ~2.1KB gz.)
3. **The event `uuid` is minted in the browser, at capture time.** It is the idempotency key the whole pipeline
   relies on: S04 dedupes on it, S07 backfill stays idempotent because of it. Mint it downstream and a network
   retry becomes an uncollapsible duplicate.
4. **Three flush triggers, none sufficient alone:** size (N events), time (T ms), and visibility/unload. On a
   dying page, `sendBeacon` (with the write key on the URL, since beacon can't set headers), falling back to a
   keepalive fetch.
5. **Durability without a delivery guarantee (yet).** The pending queue is persisted to `localStorage` and
   rehydrated on load, capped at `maxQueue` (drop oldest on overflow). Failed sends retry with backoff.
6. **Good-citizen monkey-patching.** Auto-pageview patches `history` by composing with the original (call it
   first, return its result), idempotently (no double-patch), and reversibly (teardown restores it exactly).
7. **Explicit events + auto pageviews now; full autocapture deferred.** (See the S03 debate.)

## Rationale

The SDK's failure modes are asymmetric: a dropped event is a data gap; a thrown exception is a customer outage
and a churned account. So the ordering of priorities is *don't break the page > deliver the event > be small >
be featureful.* Every principle above falls out of that ordering.

## Consequences

- Some events are lost by design (private-mode without persistence, a hard crash mid-batch, overflow drops).
  We trade completeness for safety and size, and we say so.
- Resilience behaviors (retry, persistence, beacon) are best-effort, not a delivery SLA. Hardening them for
  adverse conditions — including how the whole fleet behaves during and after a backend outage — is revisited
  under the S13 chaos work.
- **Deferred:** full autocapture (S12 cardinality lessons are a prerequisite); anonymous→identified alias
  stitching (S06).
- **Links:** ADR-0003 (the public write key this SDK carries); the S04 pipeline that dedupes on the uuid; the
  S06 identity sprint.
