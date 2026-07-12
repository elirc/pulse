# Pulse — course retrospective

Fifteen sprints, one product, one thesis: **numbers, or it didn't happen — and infrastructure arrives when a
measured need does.** This is the end-of-course review: the migration arc, the discipline tally, what a learner
should be able to do now, and where v2 goes.

## The signature arc, reviewed: Postgres → ClickHouse
The spine of the course was a datastore migration done the honest way, and it's worth tracing end to end because
every sprint fed it:
- **S01** wrote the exit criteria *first* (ADR-0002): the specific numbers at which Postgres would no longer do.
- **S05–S06** built the query language and identity on Postgres — and load-tested toward those numbers.
- **S07** executed the migration once the numbers forced it: **dual-write → backfill → verify → cutover →
  decommission**, with a live parity endpoint proving the two engines agreed before the switch and a
  reconciliation catching a real backfill gap (the planned-and-fixed arc).
- **S12** paid off the migration: rollups, sampling, and query-cost control — optimizations only worth building
  once the columnar store and the measured access patterns existed.

The lesson the arc teaches: *"Postgres until it breaks" is only credible if you wrote down what "breaks" means,
measured your way to it, and migrated with a verification you could show.* Infrastructure as a witnessed event,
not a slogan.

## The discipline tally — idempotency, counted
The course's most-repeated idea is idempotency, and by v1 it lives in **six** distinct places. Being able to
name them all is a good proxy for having internalized the course:
1. **SDK** — the client-minted event `uuid` (S03): the idempotency key is born in the browser.
2. **Consumer insert** — `ON CONFLICT DO NOTHING` on the unique uuid (S04): redelivery inserts nothing.
3. **Backfill** — keyed on the same uuid (S07): re-running the migration double-counts nothing.
4. **Identity merge** — oldest-wins deterministic order + advisory lock (S06): concurrent identifies converge.
5. **Cohort recompute** — pure + diffed (S09): re-running produces the same membership.
6. **Flag exposure** — deduped per session (S14): a flag checked 100× emits one exposure.
One key idea (do it once, safely, even under ret/redelivery), six surfaces. Idempotency is not a feature you add;
it's a property you design for everywhere state meets delivery.

## Other through-lines
- **Approximation as a contract** — bounded, documented, opt-out-able: `uniq()` HLL (S07), the cardinality
  sketch and sampling CIs (S12), the experiment "no effect detected" wording (S14). Never present an estimate as
  exact.
- **Correctness contracts named in writing** — ingest promises *never drop*; the live tail promises *fresh*
  (S11, opposite failure modes); the loss ledger is the never-drop promise made auditable (S15).
- **Ports keep CI honest** — every teaching core is pure and injected, so the whole course tests DB-less,
  Redis-less, ClickHouse-less; external clients live only in `index.ts` entries.
- **Planted flaws** — five real, load-bearing wrong decisions planted silently and harvested by commits that
  quote the ledger (#2 S07, #4 S11, #1/#3/#5 S13). The senior skill isn't avoiding bad decisions; it's finding
  them before an incident does.

## What a learner can do now
- Split a hot path from an app surface and defend the boundary under load.
- Ship a library into a hostile environment under a hard budget without breaking the host.
- Run a live datastore migration with verification, not hope.
- Reason about approximation, cardinality, and query cost — and label uncertainty honestly.
- Run an experiment that neither invents nor misses an effect, and explain why peeking lies.
- Operate a pipeline: count what came in, count what you kept, and alarm on the difference.

## v2 ideas (with the triggers that would justify them)
- **Kafka** — only on the four triggers in ADR-0012 (warehouse export, >7-day replay, many downstreams,
  throughput past the Redis ceiling). Preparation already banked in ADR-0005.
- **Session replay** — a different data shape (blobs, not events); its own ingestion and storage economics.
- **Warehouse export** — the top v2 pull; also the #1 Kafka trigger.
- **Sequential experiment testing** — the graduate course deferred in ADR-0011.
- **Client-side telemetry** — close the loss-accounting blind spot the S15 drill found (#84).

## Recap
*A pipeline in production is a promise with a ledger — count what came in, count what you kept, and alarm on the
difference.* → **Course 4 is Relay.**
