# Postmortem — consumer stall during the S15 readiness drill (blameless)

**Date:** 2026-07-11 · **Severity:** SEV-3 (drill, no customer impact) · **Author:** Pulse course · **Status:** resolved

Blameless: the goal is to fix the *system* that let a stall become a backlog, not to assign fault. Every "who"
below is a role, and every finding is a gap in tooling or telemetry, not in a person.

## Summary
During the planned incident drill, we stalled the insert consumer group under loadgen traffic. The backlog grew
as designed; the lag SLO alert fired within the expected window; scaling consumers drained the backlog; the loss
accounting confirmed **zero loss**. The pipeline behaved exactly as built. **But the drill found a real telemetry
gap it wasn't looking for** — which is the point of running one.

## Timeline (drill clock)
- **T+0** — Consumer group paused (simulated stall). Ingest kept returning 202s (backpressure watermark not yet
  crossed).
- **T+2m** — Stream backlog crossed the lag SLO; `lag_slo_burn` alert fired. Runbook opened.
- **T+3m** — Diagnosed via the pending list (the S04 PEL): entries delivered, not acked — a stalled consumer, not
  a poison pill (DLQ flat, so `dlq_growth` did NOT fire — correctly).
- **T+5m** — Scaled the consumer group; graceful loop drained the backlog.
- **T+9m** — `reconcileLoss` for the window: accepted == stored, **zero loss**. Incident closed.

## What went well
- The lag alert fired on the right signal (backlog), and the DLQ-growth alert stayed quiet (no poison pill) —
  the alerts discriminated the failure *type*, which is what let the runbook pick the right branch immediately.
- Zero loss end to end: at-least-once delivery + idempotent inserts meant the redelivered backlog stored exactly
  once. The double-entry accounting *proved* it rather than us assuming it.

## What we learned (the finding a drill is for)
**Backpressure protected the server, but nothing alerted on the SDK's queue growing client-side.** While the
consumer was stalled, ingest kept accepting — but had the stall lasted long enough to cross the backpressure
watermark, ingest would have started returning 429s, and the SDKs would have **buffered events in their
localStorage overflow queue (S03)**. We have *zero telemetry* on that client-side queue depth. A long enough
incident could silently fill and then DROP from thousands of browsers, and our server-side loss accounting would
**not see it** — those events were never accepted, so they never entered the ledger. The pipeline's conscience
has a blind spot exactly where the pipeline ends and the customer's browser begins.

> *A drill that finds nothing was rehearsed, not run.* This one found a hole in our loss accounting's coverage.

## Action items (filed as issues)
1. **[telemetry] SDK queue-depth beacon** — the SDK periodically reports its overflow-queue depth and drop count
   as a first-class event, so client-side buffering/loss is observable. *(This is the gap; filed as #84.)*
2. **[alerting] client-side drop-rate alert** — page when aggregate SDK drop count rises, closing the accounting
   blind spot beyond the ingest boundary.
3. **[runbook] add "SDK backpressure" branch** — extend the stalled-consumer runbook with the client-side
   symptoms and the queue-depth beacon to check.

## Non-action items (explicitly not doing)
- No change to at-least-once + idempotency; it worked perfectly and is load-bearing.
- No auto-scaling on lag *yet* — one drill isn't enough signal to tune a controller; revisit after three.
