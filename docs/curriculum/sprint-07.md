# Curriculum Note — Sprint 7: The Migration (Postgres → ClickHouse)

The course's centerpiece. The best migration story has three chapters: the numbers that forced it, the parity
that proved it, the deletion that finished it.

## Learning objectives
- Make the CASE for a migration with evidence: criteria written 6 sprints ago + measurements + the line crossed.
- Build for columnar reality: sort-key-as-index, batch enrichment, buffered inserts, a new dedupe.
- Execute a live migration safely: dual-write → backfill → **reconcile** → cutover → **decommission**.
- Learn that **patterns don't transfer; problems do.**

## Key concepts
- **📘 How to write a case for migration.** The Act-1 load report isn't "Postgres felt slow." It's: here are the
  three numeric criteria we wrote in S01, here are the measurements at 50M rows / 5k events/s, here is each line
  crossed — and here are the *alternatives' numbers too* (partitioned PG, Timescale). Evidence, not fashion.
- **📘 Row stores read rows; column stores read columns.** Our query touches 3 columns of 50M rows; a row store
  hauls whole rows off disk to read 3 fields. That's the whole migration in one sentence — the workload is OLAP,
  so the store should be columnar.
- **📘 The ORDER BY is the index.** ClickHouse has no secondary indexes worth speaking of; sort order = locality
  = compression = speed. You get ONE spine — choose it from your query shapes (`projectId, name, ts`), not from
  habit.
- **🔍 Patterns don't transfer; problems do.** The Postgres unique index was a *tool*, not the lesson. The lesson
  was "at-least-once needs idempotent apply." ClickHouse has no unique index, so dedupe is re-implemented
  (ReplacingMergeTree + insert-window set) — same problem, new physics. When you migrate, port the *problem's
  solution*, not last platform's *mechanism*.
- **📘 Approximation as a contract.** `uniq()` (HyperLogLog) trades ~0.5% error for speed at scale — and that's
  fine *because the error is bounded, documented, tested against (golden tolerance), and opt-out-able*
  (`uniqExact`). Approximation isn't sloppiness when it's a written contract.
- **⚠️ Dual-write ordering.** Start the shadow BEFORE backfilling, and backfill *past* the dual-write start with
  an overlap; dedupe absorbs the overlap. Get it backwards and you race a gap — which the reconciliation arc
  (fail on 3 days → overlap fix → green) caught **by counting, not by luck**.
- **📘 Never cut over on faith.** Count both sides, publish the diff, soak with a live-verify page. Migrations
  are *proven*, not believed. (Same shape as Meridian's expand/backfill/contract — datastore-sized.)
- **📘 The decommission is part of the migration.** Deleting the old write path is the last chapter. Dual-write
  forever is two systems of record — which is zero. A migration that never ends never happened.

## The debate, cashed
**ClickHouse vs TimescaleDB vs partitioned-PG + rollups?** Resolved: **ClickHouse**, with the alternatives' load
numbers published in ADR-0007. Partitioning/rollups help ingest and *rollup-able* queries but can't fix
arbitrary-filter `count(distinct person)` — the product's superpower. *Evaluate alternatives by running them,
and publish the loser's numbers too.*

## Lab (break-it #2) — `lab/sprint-07`
Re-run the S05 k6 suite against both engines at 100M rows; then kill ClickHouse mid-insert-batch and report what
the buffering layer did (which rows were lost, which survived, how the consumer recovered).

## Exercise questions
1. Write the three-line case for this migration using only baseline-01 + the Act-1 report. What makes it an
   engineering decision rather than a preference?
2. The PG dedupe was a unique index; CH's is ReplacingMergeTree + an insert-window set. Name what's the SAME and
   what's DIFFERENT, and state the invariant both preserve.
3. Backfill started before dual-write. Draw the gap. Now draw the overlap fix and explain why dedupe makes the
   overlap free.
4. `uniq()` has ~0.5% error. Give one query where that's fine and one where you'd pay for `uniqExact`, and say
   how a reader knows which they got.
5. Why is the ORDER BY `(projectId, name, ts, uuid)` and not `(ts, projectId, name)`? Answer from the S05 query
   shapes.
6. The decommission commit deletes the PG write path. Why is that a *feature*, and what would running dual-write
   forever actually cost?
