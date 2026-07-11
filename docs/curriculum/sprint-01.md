# Curriculum Note — Sprint 1: Foundation (Event → Chart Skeleton)

## Learning objectives
- See the course's defining structural choice — **ingest is a separate deployable** — made on day one.
- Understand why the naive Postgres insert is the *right* baseline, and what it deliberately doesn't do.
- Internalize **exit criteria as architecture**: write the numbers before the pain.
- Build the **measuring stick** (the traffic generator) before the thing you'll measure.

## Key concepts
- **📘 The hot path has different physics.** Ingest is spiky, latency-sensitive, write-key-authenticated, and
  driven by millions of anonymous browsers; the analyst API is heavy, occasional, and session-authenticated.
  Never let a dashboard query and an ingest burst share a process — split them, so one can't starve the other
  (ADR-0001).
- **🔍 The naive insert is correct — and it will die publicly.** `POST /e` does a synchronous single-row insert.
  That's the honest baseline. Note what it *doesn't* do: no queue (S04), no batching (S04), no dedupe (S04), no
  columnar store (S07). That list is the syllabus. Optimizing it now would rob S07 of its lesson.
- **📘 Schemaless event properties.** `props` is a JSONB bag because the event's shape belongs to whoever calls
  the SDK, not to us. That flexibility is the whole category — and the source of the cardinality reckoning in
  S12. Store it schemaless; pay to query it later, on purpose.
- **📘 Exit criteria are architecture; procrastination is not.** ADR-0002 writes down the *exact* numbers
  (ingest > ~2k/s degrading p95; trend queries > ~2s at > ~50M rows) at which Postgres stops being enough.
  Criteria written before the pain are a plan; invented after, an excuse. S07 is a date with these numbers.
- **📘 Build the measuring stick first.** The traffic generator exists in Sprint 1, before there's anything
  worth measuring — because you can't make "Postgres until it breaks" a *witnessed* event without controlled
  load. It's deterministic given a seed, so a load test reproduces exactly.

## The debate, cashed
**Kafka/Redpanda now vs Redis Streams later vs nothing yet?** Resolved: **nothing this sprint** (a synchronous
insert as the honest baseline), Redis Streams in S04 with an ADR mapping every concept to its Kafka equivalent.
*Infrastructure arrives when a measured need does — but the roadmap names it early.*

## Exercise questions
1. List three things `POST /e` doesn't do that a production ingest path must. For each, name the sprint that
   adds it and the failure that forces it.
2. ADR-0002's exit criteria are numeric. Rewrite one of them as a vague sentence ("when it gets slow"), then
   explain what the numeric version buys you that the vague one doesn't.
3. Why is the traffic generator deterministic (seeded)? What would a non-deterministic load test make impossible
   in S07?
4. The ingest server allows *any* CORS origin while the app API allows only the web origin. Why the asymmetry?
5. `props` is JSONB. Name one query that's trivial on a typed column and painful on JSONB — and hold that
   thought for S12.

## Further reading
- OLTP vs OLAP · columnar stores (ClickHouse) · write-optimized vs read-optimized schemas · load testing (k6) ·
  ADR-0001, ADR-0002.
