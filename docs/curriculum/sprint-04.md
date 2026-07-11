# Curriculum Note — Sprint 4: Ingestion Pipeline v1

## Learning objectives
- Watch the synchronous insert die on schedule (ADR-0002's first exit criterion), and replace it with exactly
  the machinery the numbers demanded — not a line more.
- Internalize the course's central discipline: **consumers are idempotent, or they don't merge.**
- Learn the sentence that governs all of stream processing: **at-least-once delivery + idempotent apply =
  effective exactly-once.**
- See Redis Streams as Kafka-with-training-wheels: the concepts (groups, PEL, ack, claim, DLQ) transfer upward.

## Key concepts
- **📘 202 means accepted, not processed.** The status code *is* the architecture. `POST /e` now validates and
  `XADD`s; storage happens later, elsewhere. The SDK may assume nothing about queryability from a 202 — a
  just-captured event is not yet in a trend, and that's correct.
- **🔍 What's cheap enough for the hot path?** Shape validation (a zod parse) stays at ingest; enrichment,
  dedup, and the insert move to the consumer. The review lens: multiply anything on the hot path by the event
  rate before you approve it.
- **📘 The pending list is where duplicates are born — by design.** An entry delivered to a consumer sits in the
  PEL until `XACK`. Crash before the ack and it's redelivered. That's at-least-once, working as specified.
- **📘 Idempotency lives in the apply, not the transport.** You don't fix redelivery by making delivery
  perfect (you can't). You make the insert idempotent: unique `uuid` + ON CONFLICT DO NOTHING. The SDK's
  client-minted uuid (S03) is what makes this possible — it earns its keep here.
- **⚠️ Dedup by unique index has a cost that grows.** A btree over every event's uuid grows unbounded, and a
  columnar store can't enforce uniqueness — so **S07 must re-solve dedup**. A correctness mechanism that the
  next architecture can't keep is a debt; name it now.
- **📘 A poison pill must not wedge the group.** One un-parseable entry retried forever blocks every event
  behind it. Route it to a DLQ with error context (a bug-report queue) and ack it; replay after the fix.
- **📘 Shed load at the edge.** When the consumer falls behind, ingest returns 429 + Retry-After — saying "no"
  at the cheapest place beats an out-of-memory consumer. Sample the depth; don't XLEN per request.

## The debate, cashed
**Dedupe at ingest (before XADD) vs at the consumer (before insert)?** Resolved: **consumer.** Ingest dedup
needs shared state on the hot path (a Redis check per event); the consumer already has a unique index and works
in batches. *Place correctness where state already lives; keep the hot path dumb.* Duplicates in the stream are
cheap; duplicates in the store are lies.

## Lab (break-it #1) — `lab/sprint-04`
Drive the loadgen up until backpressure fires (watch `GET /ops/ingest`), then kill a consumer mid-run. Write up
the recovery timeline: how many entries were pending, how redelivery replayed them, and why the store did not
gain duplicates. Prove effective exactly-once from the outside.

## Exercise questions
1. A customer complains their event "didn't show up instantly." Explain, from the 202 contract, why that's
   expected and where the delay lives.
2. Write the failure timeline for a consumer that crashes *between* the batch insert and the `XACK`. What does
   the next consumer see, and what stops it from double-counting?
3. Why dedupe at the consumer and not at ingest? Give the hot-path cost of the alternative.
4. The unique-uuid index dedupes today. Name two reasons it can't survive S07's columnar store, and sketch a
   replacement.
5. Backpressure returns 429. Trace what the SDK does with it, and one risk if every client retried on the exact
   same schedule.
6. A poison event is dead-lettered. Describe the contents you'd want on the DLQ record to make the fix-and-replay
   loop fast.
