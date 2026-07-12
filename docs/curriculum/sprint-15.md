# Curriculum Note — Sprint 15: Production Readiness → v1.0.0

The finale. The product now runs in production, and the discipline is operating it honestly: *a pipeline in
production is a promise with a ledger — count what came in, count what you kept, and alarm on the difference.*
This sprint turns "it works" into "we can prove it works, watch it, and recover it."

## Learning objectives
- Instrument a pipeline: the four numbers that ARE its health, and turning them into a verdict.
- Keep **double-entry books** on events (accepted vs stored) — the loss ledger.
- Bill from the right counter, deploy without stranding a pending list, and restore two stores that back up
  differently.
- Run an incident drill and expect it to find a telemetry gap.

## Key concepts
- **📘 Pipelines need double-entry bookkeeping.** Counted-in (ingest-accepted) vs counted-stored (in CH),
  reconciled, alarmed. "We think we got everything" is not a number; a loss ratio reconciled hourly is. This is
  the course's conscience — an analytics product that loses events silently is defective merchandise.
- **📘 Observability at data volume: sample traces, count everything.** Tracing every event would out-volume the
  events, so traces sample ~1% — *deterministically on the uuid* so every stage agrees and a trace is complete.
  ⚠️ But debugging one specific lost event needs the *accounting* (which counts all of them), not a trace you
  almost certainly didn't sample. Know which question each tool answers.
- **🔍 Self-metering is a conflict-of-interest bug class.** Pulse bills by its own medium — so meter from
  ACCEPTED counts (the customer-visible 202s), never STORED counts. Billing off post-loss storage would
  under-bill exactly when the pipeline is dropping events, hiding the loss behind the invoice. Where you read the
  meter is an ethics decision, not just an engineering one.
- **🔗 Graceful rollover is S04's crash story, now voluntary.** A consumer killed mid-batch strands a pending
  list; SIGTERM-drain (finish + XACK the in-flight batch, then exit) makes every deploy clean. *Systems that
  survive failure deploy for free* — the same pending-list discipline, orderly instead of forced. (Tracer S15
  said the same about reconnects — a cross-course law.)
- **📘 Columnar backup physics: partitions are restore units.** You don't `pg_restore` billions of rows. CH
  events are partitioned by month; `FREEZE`→`ATTACH` restores one month without touching the rest, and immutable
  old partitions are backed up once, forever. PG and CH restore differently — document them side by side or
  discover the difference at 3am.
- **📘 Every drill should find a telemetry gap.** The stall drill worked perfectly *and* revealed that nothing
  observes the SDK's client-side overflow queue — a loss blind spot past the ingest boundary. A drill that finds
  nothing was rehearsed, not run. The finding became issue #84, which is the drill's actual deliverable.

## The debate, cashed
**Move to Kafka for v2?** The Streams setup held 12k/s with headroom; Kafka buys ecosystem and retention,
costs ops weight. **Resolution:** stay, with **ADR-0012 listing the specific triggers that would flip it**
(warehouse export, >7-day replay, many downstreams, throughput past the Redis ceiling). ADR-0005's Kafka concept
map means the team already speaks Kafka, so the move is a transport swap behind the same mental model. *The
migration you prepared for and didn't need is preparation, not waste.*

## Exercise questions
1. Ingest accepted 10.0M events last hour; CH stored 9.97M. Compute the loss ratio and say whether it pages.
   Where do the two counts come from, and why must they be independent sources?
2. You need to debug why customer X's specific event never appeared. Do you reach for a trace or the accounting?
   Why is the other one almost useless here?
3. Why meter quotas from accepted counts, not stored counts? Construct the scenario where storing-count billing
   under-charges a customer *because* the pipeline is unhealthy.
4. A deploy rolls the consumer fleet. Walk through what graceful shutdown does on SIGTERM and what would happen
   to the pending list without it.
5. A recent CH partition is corrupted. Outline the restore — and why it's an `ATTACH PARTITION`, not a full
   reload. How do you verify success as a number?
6. The stall drill's alerts fired `lag_slo_burn` but not `dlq_growth`. What did that combination tell the on-call
   about the failure type, and how did it pick the runbook branch?
7. Name the six places idempotency lives across the course. What single idea do they all implement?
