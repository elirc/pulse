# ADR-0008 — Materialize behavioral cohorts; inline property cohorts

**Status:** accepted (S09) · **Deciders:** Pulse course · **Revisited:** S12 (per-cohort freshness tiers)

## Context

Two features arrived together this sprint — retention and cohorts — and each raised the same question:
**compute on read, or precompute?** Rather than answer by reflex ("precompute = fast" / "compute = simple"),
this ADR writes down the *grid* and places each feature on it.

## The grid

Three axes decide it:

| Axis | Compute-on-read favored when… | Precompute favored when… |
|---|---|---|
| **Output size** | small (a grid, a count) | small *and* reused by many callers |
| **Scan cost** | tolerable per request | high, and paid repeatedly |
| **Freshness need** | analysts want it live | staleness (minutes/hours) is acceptable |

## Decision

- **Retention → compute on read.** Small output (a cohort grid), a scan ClickHouse eats for breakfast, and
  analysts expect it fresh. Materializing it would cache a cheap-to-produce answer and add a staleness surface
  for no gain.
- **Property cohorts → inline (compute on read).** Membership is a cheap predicate over the Person table;
  running it live keeps it perfectly fresh. No materialization.
- **Behavioral cohorts → materialize.** Membership is a full event scan per evaluation, the same cohort is
  reused across trends/funnels/retention, and an hour-old member list is fine. So a scheduled job computes it
  (hourly default, per-cohort override) and writes `CohortMembership`, stamping `membersComputedAt`.

## Rationale

**Precompute is a debt against freshness and correctness; take it on only when frequency × scan-cost justifies
it.** Retention and property cohorts don't clear that bar; behavioral cohorts do. Deciding per feature — in
writing — beats a house style ("we always precompute") that's wrong half the time.

## Consequences

- **Staleness is a contract, shown in the UI.** `membersComputedAt` is displayed to analysts. Hidden staleness
  is how dashboards lie; a visible timestamp turns "is this current?" from a support ticket into a glance.
- **Derived data must explain its changes.** Every recompute logs a membership diff (added/removed). A cohort
  that silently shrinks 40% is an incident; the diff log is its black box.
- **A second system to operate** (the jobs worker + BullMQ). Justified because it removes a repeated expensive
  scan from the read path.
- **Debate resolved (see thread):** recompute on a **schedule**, not on event-stream triggers — triggers make
  every event touch N cohorts (write amplification on the hot path). Freshness is a feature with a unit price;
  the trigger design is sketched for when a customer pays for it.
- **Deferred:** per-cohort freshness tiers, cohort CSV export, lifecycle charts.
- **Links:** the S05 compute-on-read trend baseline, the S06 person store (property cohorts query it), ADR-0007.
