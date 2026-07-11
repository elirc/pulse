# Sprint 10 — Dashboards, Sharing & Subscriptions

**Branch:** `sprint-10/dashboards` · **Size:** M/L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Compose insights into dashboards with cached tile results, public share links, and scheduled email reports. Mostly fast-forward patterns — the new material is result caching for *expensive analytical* queries and the security shape of public sharing.

## A — Issues
1. `Dashboard + tiles (grid layout, insight refs)`
2. `Tile result cache: TTL + staleness display + manual refresh`
3. `Public share links (tokens) for dashboards`
4. `Scheduled email reports (rendered snapshot, fast-forward email infra)`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(db): Dashboard, DashboardTile (insightId, layout), ShareToken` | |
| 2 | `feat(api): tile results cache — redis, key = insight-def hash + date range, TTL 10m` | 🔗 Meridian S12 cache-aside, adapted: analytical queries are seconds-expensive, so stampede locking matters more; `computedAt` returned with every result |
| 3 | `feat(web): dashboard grid — drag/resize tiles, add-insight flow, staleness badges + refresh` | staleness UI carried from S9's norm |
| 4 | `feat(api): share tokens — public read-only dashboard route` | **[flaw #5]** tokens never expire, no revocation list (harvest S13) |
| 5 | `feat(web): public dashboard page — no-auth render, project branding lite` | ⚠️ public route uses a *restricted* query path: only saved insight defs execute, never ad-hoc ASTs from the public side |
| 6 | `feat(jobs): scheduled reports — render dashboard server-side, email snapshot (fast-forward)` | |
| 7 | `test(api): cache behavior — hit/miss/TTL/stampede; public route cannot execute arbitrary defs` | |
| 8 | `test(e2e): share link opens without session; scheduled report lands in mailpit` | |
| 9 | `docs: curriculum note sprint 10` | |

## C — Review order
Cache keying (2) → the public query-path restriction (5) → share tokens (4, and note what's *absent*).

## D — Teaching comments (~8)
- cache key = def hash — 📘 caching analytical results keys on the *query definition*, not the URL; hash canonicalization (🔗 Meridian S12's key-order lesson, verbatim)
- stampede at analytics scale — 📘 a 5s query × 20 dashboard viewers at 9am Monday = the dogpile; single-flight lock is mandatory here, was optional for CRUD
- restricted public path — 🔍 review-lens: a public endpoint that executes stored definitions is fine; one that executes request-supplied definitions is a data-exfiltration API; the boundary is *whose* query runs
- share token entropy — 📘 128-bit random, constant-time compare… and note what's missing (expiry, revocation) — *(silence on the flaw itself)*
- server-side render for email — 🔗 fast-forward from Meridian PDF lessons; snapshot-at-send vs live-link semantics named in the email footer

## E — Debate
**"Cache invalidation on new events vs TTL-only for tiles?"** Event-driven: fresh, but *every* insight is potentially touched by every event — invalidation fan-out with no cheap mapping. TTL: bounded staleness, trivial. **Resolution:** TTL + manual refresh + staleness badges; event-driven invalidation is a poor fit when the write rate is 10k/s and the mapping is opaque. Lesson: *invalidation strategies must match write physics — Meridian's event-driven answer is wrong here, and knowing why is the point.*

## F/G — Close
- Squash: `feat(sprint-10): dashboards, sharing, scheduled reports (closes #…)`
- Deferred: dashboard templates, tile-level date overrides, Slack delivery.
- Ledger: flaw #5 recorded.
- Recap idea: *the same cache pattern got a different invalidation answer than last course — patterns are conditional on physics.*
