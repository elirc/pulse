# ADR-0005 — Redis Streams for ingestion (with a Kafka concept map)

**Status:** accepted (S04) · **Deciders:** Pulse course · **Revisited:** S07 (dedup under the columnar store)

## Context

The synchronous insert (S01–S03) put storage on the ingest hot path: a burst couldn't be absorbed, and a
retry double-inserted. ADR-0002 named the exit criteria; S04 crosses the first one. We need a durable buffer
between "accepted" and "stored" so ingest can ack fast and a separate consumer can do the heavy work.

The reflex answer is Kafka. We choose **Redis Streams** instead: we already run Redis, and Streams provide the
same primitives — a durable append-only log, consumer groups, per-consumer pending lists, and claim/redelivery
— at a fraction of the operational weight, at our scale. Crucially, the *concepts* transfer directly, so the
learning is portable upward to Kafka.

## Decision

Ingest becomes **enqueue-only**: validate cheaply, `XADD`, return **202 Accepted**. A separate **consumer**
deployable reads via a **consumer group**, enriches, batch-inserts, and `XACK`s. Poison events go to a **DLQ**;
backpressure sheds at the edge with **429 + Retry-After**.

### Streams ≈ Kafka concept map

| Redis Streams | Kafka | Role in Pulse |
|---|---|---|
| `XADD` | produce to a topic | ingest appends an event |
| consumer group | consumer group | each entry delivered to one consumer |
| stream entry id | offset | position / ordering |
| **pending entries list (PEL)** | **delivered-but-uncommitted offsets** | **where redelivery — and duplicates — come from** |
| `XACK` | commit offset | mark an entry done |
| `XAUTOCLAIM` | partition reassignment / rebalance | rescue a dead consumer's stuck pending entries |
| `XLEN` / backlog | lag | backpressure + the ops endpoint |
| dead-letter stream | dead-letter topic | poison events, out of the main flow |

## Rationale

**Place correctness where state already lives; keep the hot path dumb.** The hot path does the least possible
(validate + append); everything stateful (dedup against a unique index, enrichment, batching) happens in the
consumer where the database — and the batch — already are.

**Delivery guarantees are properties of a pair, not a transport.** Redis Streams gives *at-least-once*: a
consumer that crashes after inserting but before `XACK` will see those entries redelivered. That is not a bug to
engineer away in the transport; it is the contract. We make the *apply* idempotent (unique `uuid` + ON CONFLICT
DO NOTHING), and **at-least-once delivery + idempotent apply = effective exactly-once.** Memorize that sentence.

## Consequences

- **202 is a contract change**: *accepted, not processed*. The SDK may assume nothing about queryability from
  it; a just-sent event is not immediately in a trend.
- The unique-`uuid` index is a growing btree over every event. It works now on Postgres; **S07 must re-solve
  dedup** when events move to a columnar store that can't enforce uniqueness (TTL'd dedup set / merge-time
  dedup).
- Two more moving parts to operate (Redis, a consumer). The `/ops/ingest` endpoint exposes their health; S15
  alerts on it.
- **Links:** ADR-0001 (ingest split), ADR-0002 (exit criteria — this crosses the first), the S07 migration
  (which re-solves dedup), `@pulse/stream`.
