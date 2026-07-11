# Sprint 11 — Live Events & Web Analytics

**Branch:** `sprint-11/live-web-analytics` · **Size:** M/L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Real-time surfaces over the pipeline: a live event tail streamed from the ingest stream itself (killing the S5 polling flaw), sliding-window "users online now" counters in Redis, and a web-analytics overview (top pages, referrers, sessions-lite).

## A — Issues
1. `Live event tail: SSE from the stream (replaces S5 polling feed)`
2. `"Online now": sliding-window unique counters in Redis`
3. `Web analytics overview: top pages/referrers/UTM, session-lite metrics`
4. `Session-ization: 30-min-gap session ids computed at ingest`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(api): live tail — SSE endpoint consuming a dedicated fan-out consumer group` | tail readers get their own group: analytics consumers must never compete with the insert consumer's pending list |
| 2 | `refactor(web): live feed consumes SSE; polling endpoint deleted` | **harvests flaw #4**, ledger quoted; the raw-table poll dies |
| 3 | `feat(api): live tail filters — project, event name, person; server-side predicate` | filter on the stream, not the client — bandwidth argument in body |
| 4 | `feat(consumer): session-ization — 30-min-gap sessionId stamped at enrichment` | sessions are an ingest-time enrichment, not a query-time reconstruction: the S6 "resolve at write" grid, applied again |
| 5 | `feat(api): online-now — redis sliding window (sorted set by last-seen, ZCOUNT over 5m)` | ephemeral state in Redis, durable in CH (🔗 Tracer S9's durable/ephemeral split, data-sized) |
| 6 | `feat(web): web analytics overview — visitors, pageviews, top pages/referrers/UTM, live counter` | CH queries reuse the trends compiler; the page is saved-insights-in-a-trenchcoat (deliberately: no new query engine) |
| 7 | `test(api): SSE tail under load — slow client backpressure (drop policy, not buffer-to-OOM)` | a slow dashboard tab must not back-pressure the pipeline; per-client ring buffer + drop counter |
| 8 | `test(e2e): sdk pageview → appears in tail <2s → online-now increments` | |
| 9 | `docs: ADR-0009 SSE + drop policy for tails; curriculum note` | |

## C — Review order
Dedicated consumer group (1) → session-ization placement (4) → slow-client policy (7).

## D — Teaching comments (~9)
- separate consumer group — 📘 fan-out isolation: the observer must not slow the writer; groups as blast-radius boundaries
- SSE here, again — 🔗 third SSE decision across courses (Meridian yes, Tracer no, Pulse yes) — reconstruct the rule from the three: *one-directional + HTTP-friendly + resumable = SSE*
- session at ingest — 📘 the precompute grid again: sessions queried constantly, defined stably, cheap to stamp in-stream → write-time; contrast with retention (read-time)
- 30-min gap — ⚠️ session definitions are lore-encrusted defaults; document it as a *setting with a default*, not truth
- sliding-window uniques — 📘 sorted-set-by-timestamp: O(log n) upkeep, ZCOUNT reads, self-expiring; when this beats HLL (small windows, exactness cheap)
- drop policy — 📘 for live tails, freshness > completeness: drop old frames for slow clients and *count the drops*; the opposite policy from the ingest path — same system, two correctness definitions
- deleted polling endpoint — 🔍 review-lens: the flaw-harvest includes removing the bad path, not just adding the good one

## E — Debate
**"Sessions at ingest vs at query time?"** Query-time: definition can change retroactively. Ingest: cheap, stable, but a definition change only affects the future. **Resolution:** ingest, with the definition versioned in event props (`$session_v: 1`) so a future change is analyzable rather than silent. Lesson: *when you freeze a decision into data, stamp the decision's version next to it.*

## F/G — Close
- Squash: `feat(sprint-11): live tail, online-now, web analytics (closes #…)`
- Deferred: bot filtering, channel grouping rules, live tail pause/inspect UX.
- Ledger: flaw #4 closed.
- Recap idea: *real-time analytics is a different correctness contract — fresh and lossy beats complete and late, and you must write down which one each surface promises.*
