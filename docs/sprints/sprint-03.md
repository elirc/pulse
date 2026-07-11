# Sprint 03 — Browser SDK v1

**Branch:** `sprint-03/browser-sdk` · **Size:** L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** The library sprint: a zero-dependency browser SDK shipped to strangers' pages. Batching, flush strategies, sendBeacon on unload, offline queueing, anonymous identity — under a CI-enforced <6KB gz budget and a "never break the host page" policy.

## A — Issues
1. `packages/sdk: init, capture(), identify(), reset(); anonymous id lifecycle`
2. `Transport: batching, flush triggers (size/interval/visibility), sendBeacon, retries`
3. `Resilience: localStorage queue, never-throw policy, backend-down behavior`
4. `Build & budget: tsup, ESM+UMD, <6KB gz CI gate, semver v0.1.0`
5. `Auto pageview capture (SPA-aware)`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(sdk): core — init(key, options), capture(name, props), event envelope (uuid, ts, distinctId)` | event uuid minted here — 🔗 S4's dedupe and S7's backfill idempotency both hang off this id |
| 2 | `feat(sdk): anonymous identity — generated distinctId, localStorage persistence, identify()/reset()` | pre-identify events and the alias problem *named* but deferred to S6, with a pointer comment |
| 3 | `feat(sdk): batching transport — queue, flush on N events / T seconds / visibilitychange` | |
| 4 | `feat(sdk): sendBeacon on pagehide + fetch keepalive fallback` | the last-events problem: unload is hostile territory; what beacon guarantees and what it doesn't |
| 5 | `feat(sdk): retry with backoff on 5xx/network` | **[flaw #1]** no jitter, no cap, no circuit breaker — every tab retries in sync (harvest S13) |
| 6 | `feat(sdk): localStorage overflow queue + never-throw wrapper` | SDK errors are swallowed + optionally reported; a broken analytics lib must never break checkout |
| 7 | `feat(sdk): auto pageview — history.pushState/popstate patching for SPAs` | monkey-patching someone else's page: the etiquette (idempotent patch, preserve original, feature flag) |
| 8 | `chore(sdk): tsup build ESM+UMD, size-limit CI gate <6KB gz, semver v0.1.0` | |
| 9 | `test(sdk): fake-timer flush tests; beacon on unload (playwright); never-throw (backend 500s, host page unaffected)` | |
| 10 | `feat(web): docs page — install snippet, API reference` | |
| 11 | `docs: ADR-0004 SDK design principles; curriculum note` | |

## C — Review order
Envelope + uuid (1) → transport (3–5) → never-throw (6) → the budget gate (8).

## D — Teaching comments (~11)
- event uuid at source — 📘 idempotency keys are minted where intent is born (🔗 Tracer S7 said the same about mutations); everything downstream dedupes on this
- flush triggers — 📘 the three-trigger pattern (count/time/visibility) and why any single one fails: pure-count loses trickles, pure-time loses unloads
- sendBeacon — ⚠️ fire-and-forget: no response, ~64KB budget, no headers worth trusting; why the write key rides the URL there and what that means for logs (redaction!)
- retry commit — *(no comment on the missing jitter — flaw #1 stays silent; the S13 chaos test will make it unforgettable)*
- never-throw — 📘 you are a guest in someone's page: the wrapper policy, and reporting your own errors without recursing
- pushState patching — ⚠️ other libraries patch it too; compose, don't clobber; the restore-on-teardown test
- size-limit gate — 📘 bundle budget as CI contract: every dependency is a negotiation; this is why zero-dep
- pre-identify events — 🔗 the anonymous→identified stitching problem is *the* identity problem; S6 exists because of this comment

## E — Debate
**"Full autocapture (every click) vs explicit events + auto pageviews?"** Autocapture: zero-integration magic, but selector-soup data, huge event volume, privacy surface. Explicit: intentional schema, analyst-friendly. **Resolution:** explicit + auto pageviews now; autocapture deferred with a design sketch (S12's cardinality lessons are prerequisites — magic without guardrails floods the store). Lesson: *magic features have data-quality invoices; read them first.*

## F/G — Close
- Squash: `feat(sprint-03): browser sdk v1 (closes #…)`
- **Lab:** `lab/sprint-03` — three bugs: a flush-loop that drops events on concurrent flush, a patched pushState that breaks the host router, a budget bust from an accidental dependency. Junior debugs against a demo host page.
- Ledger: flaw #1 recorded.
- Recap idea: *a library is an app with a thousand hostile deploy environments — design for the worst page you'll ever be pasted into.*
