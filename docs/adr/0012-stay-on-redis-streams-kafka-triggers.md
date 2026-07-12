# ADR-0012 — Stay on Redis Streams for v1; the specific triggers that would flip us to Kafka

**Status:** accepted (S15) · **Deciders:** Pulse course · **Revisited:** —

## Context

S04 chose Redis Streams as the ingestion transport, with ADR-0005 deliberately mapping its concepts onto Kafka's
(consumer groups, pending lists, at-least-once) so the team could reason in Kafka terms. At v1.0 the question is
fair: for v2, do we move to Kafka?

## Decision

**Stay on Redis Streams for v1.** Record the *specific* v2 features that would flip the decision, so the move is
a triggered response to a measured need, not a resume-driven rewrite.

**Triggers that would flip us to Kafka (any one):**
1. **Warehouse export / connector ecosystem** — customers wanting Snowflake/BigQuery/S3 sinks. Kafka Connect is
   a mature ecosystem; building equivalents on Streams is reinventing it.
2. **Replay windows > 7 days** — Streams retention is memory-bound; durable, long-horizon replay (reprocess a
   month after a logic fix) wants a log-structured store with cheap disk retention.
3. **Multi-consumer fan-out at high scale** — many independent downstreams (billing, ML, export, search)
   reading the same firehose. Streams handles a few groups; dozens of independent high-throughput consumers is
   Kafka's home turf.
4. **Throughput beyond a single Redis primary's ceiling** — the S07 lab held 12k events/s with headroom; a
   sustained order-of-magnitude past that, with the partition parallelism to match, argues for Kafka.

## Rationale

**The Streams setup held 12k/s with room** (S07 baseline). Kafka buys ecosystem (connectors), retention
semantics (durable long replay), and partition parallelism — and costs real operational weight (ZooKeeper/KRaft,
rebalancing, more moving parts). None of v1's requirements cross that line, so paying the ops cost now would be
buying capability we can't yet use.

**We already speak Kafka.** ADR-0005's concept map means the migration, if triggered, is a transport swap behind
the same mental model (groups, PEL, at-least-once), not a re-education. The `EventStream` port (S04) was designed
so the transport is injectable — a `KafkaEventStream` implementing the same interface is the shape of the move.

## Consequences

- v2 planning watches the four triggers as *metrics*, not opinions: export demand (sales signal), replay-window
  requests, downstream count, sustained throughput vs the Redis ceiling.
- The `EventStream` port stays the seam; no code outside `index.ts` entries assumes Redis.
- **The lesson, recorded:** *the migration you prepared for and didn't need is preparation, not waste.* ADR-0005
  bought optionality; exercising it is a future trigger's job, not this ADR's.
- **Links:** ADR-0005 (Streams + the Kafka concept map), ADR-0002/0007 (measure-then-migrate — the same
  discipline that governed PG→CH now governs Streams→Kafka), the course retrospective.
