# ADR-0009 — SSE for live tails; drop-oldest for slow clients

**Status:** accepted (S11) · **Deciders:** Pulse course · **Revisited:** —

## Context

The live event feed needs to be real-time. S05 polled the events table every 5s (flaw #4: a full scan per
viewer). We want to push events as they arrive. Two decisions: the transport, and what happens when a client
can't keep up.

## Decision

- **Server-Sent Events (SSE)** for the transport.
- A **dedicated fan-out consumer group** ("tail") on the ingest stream feeds a hub; tail readers never touch the
  insert consumer's pending list.
- **Drop-oldest** for slow clients: each client gets a bounded ring buffer; on overflow we drop the *oldest*
  frames and **count the drops** (surfaced as "N skipped"). We never grow memory without bound and never
  back-pressure the pipeline.

### Why SSE (the third such decision across the courses)
| Course | Real-time need | Choice |
|---|---|---|
| Meridian | server→client notifications | **SSE** |
| Tracer | bidirectional collab cursors | WebSocket (not SSE) |
| Pulse | server→client event tail | **SSE** |

Reconstruct the rule from the three: **one-directional + HTTP-friendly + resumable → SSE.** The tail is
server→client only (no client→server messages), rides plain HTTP (works through proxies, no upgrade dance), and
is naturally resumable (`Last-Event-ID`). Reach for WebSocket only when you need the *bidirectional* channel
Tracer did.

## Rationale

**The observer must not slow the writer.** A dedicated consumer group makes the tail's blast radius its own —
a slow tab grows *its* pending list, not the inserter's. Groups are blast-radius boundaries.

**A live tail has the opposite correctness contract from the ingest path.** Ingest promises *never drop*
(at-least-once, durable). A live tail promises *fresh* — a viewer wants the last few seconds, not a complete
replay from ten minutes ago. So the right failure mode is drop-oldest-and-count, the exact inverse of the
pipeline. The lesson: **two surfaces in one system can have opposite correctness definitions; name which each
one promises, in writing.**

## Consequences

- Slow clients see gaps (with a visible "N skipped" count) — acceptable and honest for a live view.
- SSE's one-directional limit means filters are applied at connect time (query params), not via an upstream
  message; changing a filter reconnects the stream.
- **Links:** flaw #4 (harvested here), ADR-0005 (the stream + consumer groups), the S09 durable/ephemeral split
  (online-now state is ephemeral in Redis; events are durable in ClickHouse).
