# ADR-0001 — Ingest is a separate deployable from the app API

**Status:** accepted (S01) · **Deciders:** Pulse course

## Context

Pulse has two very different kinds of traffic. **Ingest** (`POST /e`) is the firehose: spiky, high-volume,
latency-sensitive, authenticated by a public write key embedded in strangers' pages, and it must accept events
as fast as browsers send them. **The app API** serves analysts: dashboards and insight queries that can be
slow, heavy, and occasional. These have different physics, different scaling curves, different risk, and
different deploy cadences.

## Decision

Split them into **two deployables from day one**: `apps/ingest` (the hot path) and `apps/api` (the analyst
surface). They share `packages/{db,shared}` but run as separate processes/services.

The reasons, made concrete:
- **Isolation of failure and load.** A dashboard query that table-scans 100M rows must never be able to starve
  the ingest path of a connection or a CPU. Co-located, one bad analyst query degrades every customer's event
  collection. Split, the blast radius is contained.
- **Independent scaling.** Ingest scales with *end-user traffic* (millions of anonymous browsers); the app API
  scales with *analyst seats* (dozens). Scaling them together wastes money on one axis and starves the other.
- **Different auth models.** Ingest takes a **public write key** (safe to embed in client JS, write-only,
  S02); the app API takes an authenticated analyst session. Keeping them in one process invites confusing a
  write key for a read credential — a privilege-confusion bug we deliberately provoke and fix in S02.
- **Different deploy cadence & risk.** You want to ship dashboard features freely; you want to touch the
  event-collection path rarely and carefully. Separate deployables let you.

## Consequences

- Two Fastify apps, two ports (ingest 3002, api 3001). CORS differs: ingest allows *any* origin (the SDK posts
  from customer sites); the app API allows only the analyst web origin.
- Shared types (`@pulse/shared`) keep the event contract identical across the boundary.
- **Foreshadow:** in S04 a queue (Redis Streams) sits *behind* ingest so `POST /e` returns before the write
  lands; in S07 the events *store* migrates to ClickHouse while metadata stays in Postgres — the OLTP/OLAP
  split forced by measured need, not guessed now.
- **Links:** ADR-0002 (Postgres-first exit criteria); the S01 debate (Kafka now vs Redis Streams later vs
  nothing yet).
