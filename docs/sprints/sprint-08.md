# Sprint 08 — Funnels (Dialogue Format)

**Branch:** `sprint-08/funnels` · **Size:** L · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Multi-step funnel analysis — the query pattern that separates analytics engineers from CRUD engineers. Dialogue format: **the learner authors the junior implementations**; the AI reviews and rebuilds them as single columnar queries.

## A — Issues
1. `Funnel insight type: ordered steps, conversion window, per-step counts + drop-off`
2. `Step filters (event + property) and breakdown by property`
3. `Funnel UI: step builder, conversion viz, time-to-convert`
4. `Correctness fixtures: hand-computable journeys`

## B — Commits (J = learner, S = AI senior pass)
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(db): funnel query def added to Insight schema (versioned)` | steps[], window, exclusions deferred |
| 2 | `feat(api): funnel — [J] N queries + JS: fetch step-1 persons, then step-2 in-window, …` | correct on fixtures; body honestly reports: 4 steps × 1M persons = 40s and an OOM at scale |
| 3 | `refactor(api): funnel — [S] single windowFunnel()-style CH query` | sequence matching in one pass over ORDER BY-local data; 40s → 300ms; review-as-commit-body walks J's version with respect: *correct first, fast second is the right order — now we make it fast* |
| 4 | `feat(api): per-step breakdown + time-to-convert percentiles — [J then S in one commit]` | J's attempt kept as the test oracle; S's quantile() version shipped; the oracle *pattern*: slow-but-obvious implementations make great correctness tests |
| 5 | `feat(web): funnel builder + conversion visualization (dataviz conventions)` | drop-off bars, step medians |
| 6 | `test(api): journey fixtures — 12 hand-traced personas; strict vs any-order semantics pinned` | ordered-with-gaps semantics documented: A…B counts, B…A doesn't |
| 7 | `test(api): window-boundary cases — event at exactly window edge, same-timestamp steps` | the off-by-one museum of funnel analytics |
| 8 | `docs: funnel semantics doc + curriculum note (incl. learner retro)` | semantics doc is user-facing: analysts must know what "conversion" means, precisely |

## C — Review order
J's implementation (2) — *predict its complexity class before reading the body* → S's rebuild (3) → the semantics doc → boundary tests (7).

## D — Teaching comments (~10)
- J's N+1-at-scale — 🔍 review-lens: the shape is fine, the *cardinality* is the bug; always annotate loops with their N; 🔗 Tracer S8 taught "multiply everything" for UI — same law, data-sized
- windowFunnel thinking — 📘 sequence matching inside the engine: one scan, state machine per person, all locality from ORDER BY (🔗 the S7 spine choice pays for this sprint)
- oracle pattern — 📘 keep the slow-obvious version as the test of the fast-clever one; the pair is worth more than either
- same-timestamp steps — ⚠️ two events, one millisecond: is that a sequence? decide, document, test — silent ties are how two analysts get two truths
- conversion-window semantics — 📘 windows anchor at step-1 entry (not previous step) — an explicit product decision with revenue implications; the semantics doc exists because queries are contracts with analysts
- percentile time-to-convert — 📘 quantile sketches vs exact; medians lie less than means for skewed durations

## E — Debate
**"Strict-order funnels (no other events between) vs ordered-with-gaps?"** Strict: intuitive to some, brutal in practice (any pageview breaks the chain). Gaps: standard, matches intent. **Resolution:** ordered-with-gaps default; strict as a per-funnel toggle later (issue filed). Lesson: *analytics semantics are product decisions wearing SQL costumes — write them down where analysts read.*

## F/G — Close
- Squash: `feat(sprint-08): funnels (closes #…)`
- Deferred: exclusion steps, funnel trends-over-time, strict-order toggle.
- Recap idea: *correct-then-fast, with the correct version kept as the fast version's conscience.*
