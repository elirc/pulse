# Lab (break-it #4) — Sprint 13: replay the outage, then hunt a surviving copy

Two operational exercises against the S13 hardening (no planted bugs): **prove** the thundering-herd fix with a
before/after graph, and **stress** the GDPR deletion by hunting for any copy that survives. Needs real infra
(`docker compose up` — postgres + redis + clickhouse + services).

## Setup
```bash
docker compose up --build
docker compose exec -T clickhouse clickhouse-client --database pulse < packages/db/clickhouse/schema.sql
docker compose exec -T clickhouse clickhouse-client --database pulse < packages/db/clickhouse/rollups.sql
```

## Part A — replay the outage sim against the fixed SDK (flaw #1, before vs after)
Reproduce the recovery herd, then confirm it's gone.

1. **Load** a page with ~200 SDK instances (open 200 tabs, or script 200 `Pulse` clients pointed at the ingest).
2. **Outage**: make ingest return 503 for 10 minutes (a feature flag, or `docker compose pause ingest` for a
   coarser version). Keep all clients firing events.
3. **Recover**: bring ingest back. Sample the request arrival rate per second across the first 30s of recovery.

Do it twice:
- **Before** — check out `git stash`-ed or reverted `withRetry` (or set `jitter: () => 1`, `breaker` disabled,
  no cap) to simulate the S03 behaviour.
- **After** — the shipped `withRetry` (jitter + cap + `CircuitBreaker`).

**Produce a graph** of arrival-rate-vs-time for both. Record the peak multiple over steady state (the PR claims
~40× → ~1.3×). Then answer:
1. Which of the three fixes (jitter, cap, breaker) flattens the spike the most? Disable them one at a time to
   attribute the effect.
2. With the breaker open, where do the events go? (Read the SDK overflow queue — they should park, not drop.)
3. What does the breaker's HALF-open probe look like on the graph — one request, or a small cluster? Why?

## Part B — delete a person, then hunt for a surviving copy
The deletion sweep claims to erase every copy. Try to prove it wrong.

1. **Seed** a person with a rich footprint: many events (some clock-skewed so `$ts_clamped` is set), a cohort
   membership (materialize a behavioral cohort they belong to via `@pulse/jobs`), and **warm the tile cache** by
   loading a dashboard whose tiles aggregate their data.
2. **Delete** them: `POST /gdpr/persons/:personId/delete` (needs a session). Note the returned request id.
3. **Hunt.** For each store, query directly for the person's `distinctId`s:
   - ClickHouse `events` — `SELECT count() FROM events WHERE distinctId IN (...)` → expect 0.
   - Postgres — `Person`, `DistinctIdMapping`, `CohortMembership` → expect 0.
   - The **tile cache** — re-request the dashboard tile you warmed. Is the deleted person still in the number?
   - The **DLQ** and any in-flight stream backlog — could an un-drained event re-insert them *after* deletion?
4. Check the **ledger**: `GET /gdpr/deletions/:id`. Is `status` completed and `remaining` 0? Force a failure —
   kill ClickHouse before the lightweight delete applies — and confirm the request is marked `failed`, not
   silently "done".

**Document, with evidence:** every store you checked and its count; whether any copy survived (and if so, which
store the sweep forgot); and — the real deliverable — **the store you had to add to the deletion code to make the
hunt come up empty**, if any. The deletion test (`deletion-completeness.test.ts`) is where that fix belongs.

## Done when
You can show: the before/after recovery-herd graph with peak multiples and per-fix attribution; and a
store-by-store deletion hunt that comes up empty (or the exact gap you found and closed), plus the ledger proving
the erasure — the compliance evidence, not just your word.
