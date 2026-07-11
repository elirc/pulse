# Sprint 07 — The Migration: Postgres → ClickHouse (Flagship)

**Branch:** `sprint-07/clickhouse-migration` · **Size:** XL · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** The course's centerpiece. Act 1 breaks Postgres publicly against the ADR-0002 exit criteria. Act 2 stands up ClickHouse and rebuilds the consumer for columnar reality (batch enrichment, async inserts, a new dedupe answer). Act 3 executes the live migration: dual-write → backfill → verify → cutover → decommission.

## A — Issues
1. `Load evidence: drive PG past the ADR-0002 exit criteria (published report)`
2. `ClickHouse: schema (ORDER BY, partitioning), docker-compose + prod story`
3. `Consumer v2: batch enrichment, async inserts, columnar-safe dedupe`
4. `Live migration: dual-write, backfill with verification, cutover flag, decommission`
5. `Query layer: trend/insight compiler targets ClickHouse; goldens must not change`

## B — Commits (three acts)
### Act 1 — Break it publicly
| # | Commit | Notes |
|---|--------|------|
| 1 | `docs: load report — PG at 50M rows / 5k events/s vs ADR-0002 criteria` | trend p95 11s (limit: 3s), ingest lag growing unbounded, vacuum pain, index bloat — graphs committed; **the S1 promise kept: we migrate on evidence, not fashion** |

### Act 2 — Build the new engine
| # | Commit | Notes |
|---|--------|------|
| 2 | `feat(db): clickhouse — events table (ORDER BY (projectId, name, ts), monthly partitions)` | ADR-0007: ORDER BY is the primary index *and* the compression story; chosen from actual query shapes (S5 insights) |
| 3 | `feat(consumer): batch enrichment — UA/geo vectorized over the whole batch` | **harvests flaw #2**, ledger quoted; per-event 1.9k/s → batched 14k/s (numbers in body) |
| 4 | `feat(consumer): CH writer — async batched inserts, insert-window buffering` | batch sizing for columnar (bigger is better, to a point); wait/flush semantics |
| 5 | `feat(consumer): dedupe v2 — ReplacingMergeTree(uuid) + insert-window in-memory set` | ⚠️ the PG unique-index answer doesn't exist here; eventual dedupe + FINAL-avoidance strategy — the "same problem, new physics" lesson |
| 6 | `feat(api): insight compiler v2 — same query defs (S5 versioning pays off) compile to CH SQL` | uniq() vs uniqExact — approximate distinct enters the course |
| 7 | `test(api): golden parity — every S5 golden fixture passes against CH within defined tolerance` | tolerance is *defined* (uniq() error bounds) not hand-waved |

### Act 3 — Migrate live
| # | Commit | Notes |
|---|--------|------|
| 8 | `feat(consumer): dual-write behind flag — PG (truth) + CH (shadow)` | |
| 9 | `feat(tools): backfill — PG history → CH in partition-sized chunks, resumable, idempotent` | uuid dedupe makes re-runs safe (🔗 S3's uuid, third payoff) |
| 10 | `test(tools): reconciliation — per-day counts + per-project uniques PG vs CH, FAILS on 3 days` | **[in-PR arc]** drift found: backfill raced dual-write start; fix = overlap window + dedupe absorbs it |
| 11 | `fix(tools): backfill overlap window; reconciliation green` | |
| 12 | `feat(api): read cutover flag — insights read CH; live-verify page (PG vs CH side-by-side) for a soak week` | |
| 13 | `chore(db): decommission PG events writes; PG events table archived` | the deletion commit — reviewed as carefully as any addition |
| 14 | `docs: k6 baseline #2 — CH: 12k events/s sustained, 10M-row trend 90ms; ADR-0007; curriculum note` | the after photo beside S5's before |

## C — Review order
Load report (1) → ORDER BY design (2, with ADR) → dedupe v2 (5) → **the migration arc (8→13) in order** → baseline #2.

## D — Teaching comments (~14)
- load report — 📘 how to write a case for migration: criteria (written 6 sprints ago) + measurements + the line crossed; compare to "Postgres felt slow"
- columnar mental model — 📘 row stores read rows, column stores read columns; why analytics reads 3 columns of 50M rows and OLTP reads 50 columns of 3 rows — the whole migration in one sentence
- ORDER BY — 📘 there are no secondary indexes worth speaking of; sort order = locality = compression = speed; you get one spine, choose it from query shapes
- dedupe v2 — 🔍 review-lens: patterns don't transfer, *problems* do; the PG answer (unique index) was a tool, not the lesson — the lesson was "at-least-once needs idempotent apply," and CH forces a new implementation
- uniq() tolerance — 📘 approximate algorithms as an engineering contract: error bounds documented, golden tests with tolerance, exact available when it matters
- dual-write ordering — ⚠️ start shadow writes *before* backfill or you race a gap; the reconciliation arc (10→11) shows the race caught by counting, not by luck
- reconciliation — 📘 never cut over on faith: count both sides, publish the diff, soak with live-verify; migrations are proven, not believed (🔗 Meridian S7 expand/backfill/contract — same shape, datastore-sized)
- decommission commit — 📘 deleting the old path is part of the migration; dual-write forever is two systems of record, i.e., zero

## E — Debate
**"ClickHouse vs TimescaleDB vs Postgres partitioning + rollups?"** Timescale/partitions: stay in one system, real gains — but COUNT(DISTINCT persons) over arbitrary property filters is the workload, and it wants columnar. **Resolution:** ClickHouse; the ADR shows the same load test run against a partitioned-PG spike branch (honest comparison, numbers included). Lesson: *evaluate alternatives by running them, and publish the loser's numbers too.*

## F/G — Close
- Squash: `feat(sprint-07): clickhouse migration — dual-write, backfill, cutover (closes #…)`
- **Lab (break-it #2):** junior re-runs the S5 k6 suite against both engines at 100M rows; then kills CH mid-insert-batch and reports what the buffering layer did.
- Ledger: flaw #2 closed.
- Recap idea: *the best migration story has three chapters: the numbers that forced it, the parity that proved it, the deletion that finished it.*
