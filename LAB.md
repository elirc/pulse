# Lab (break-it #3) — Sprint 12: a pathological high-cardinality property

An operational exercise (no planted bugs): manufacture the exact input the S12 guards exist for — an event
property whose value is unique on every event (a UUID) — watch the cardinality tracker and the guards respond,
then **disable the guard on a throwaway branch** and document the damage. The point is to *feel* why the guard is
load-bearing, not to read that it is.

Needs real infra (`docker compose up` — postgres + redis + clickhouse + services).

## Setup
```bash
docker compose up --build
docker compose exec -T clickhouse clickhouse-client --database pulse < packages/db/clickhouse/schema.sql
docker compose exec -T clickhouse clickhouse-client --database pulse < packages/db/clickhouse/rollups.sql
export READ_FROM_CH=true    # read from ClickHouse so the guards are on the live path
```

## Part A — manufacture the pathological property
The demo generator carries bounded props (`$browser`, `plan`). You want an **unbounded** one. In
`packages/loadgen/src/demo.ts` (or a scratch generator), attach a fresh UUID to every event:

```ts
props: { ...personaProps, session_id: crypto.randomUUID() }   // distinct on EVERY event
```

Then drive load:
```bash
pnpm --filter @pulse/loadgen start -- --rate 500 --seconds 120 --url http://localhost:3002/e
```

While it runs, watch the per-property distinct sketch fill up:
- `apps/consumer/src/cardinality.ts` — the `CardinalityTracker` maintains a `HyperLogLog` per property.
  `snapshot()` is the data-management surface. Log it or expose it and observe `session_id` climb toward the
  event count while `$browser` stays ~5.

**Record:** how fast does `session_id`'s estimate cross the 10k threshold? How far off is the HLL estimate from
the true count (you know the true count — it's ~one per event)? Is ~2% error acceptable for a *guard* decision?

## Part B — watch the guard fire
Run a breakdown by the pathological property against the API:
```bash
curl -s -D - -X POST localhost:3001/insights/trend \
  -H 'content-type: application/json' \
  -d '{"projectId":"demo-project","spec":{"event":"$pageview","metric":"total","breakdown":"session_id","interval":"day"}}'
```

**Observe and record:**
1. The `x-cardinality-notice` response header — what does it say, and what `topN` did the guard force?
2. The body: how many series came back? Confirm it is `GUARDED_TOP_N` + an "Other" bucket, not thousands.
3. Compare against a breakdown by `$browser` (low cardinality): no notice, full breakdown. Same endpoint, guard
   quiet — the guard is *conditional on the data*, driven by the tracker, not a blanket cap.

## Part C — disable the guard and document the damage (throwaway branch)
On a branch you will **throw away**, neuter the guard and watch what breaks:
```bash
git checkout -b scratch/no-cardinality-guard
```
In `apps/api/src/server.ts`, short-circuit the guard (e.g. force `guarded=false`, or skip the
`opts.cardinalityOf` block entirely). Re-run the Part B breakdown.

**Document, with evidence:**
1. How many series does the response now contain? What is the payload size (bytes) vs. the guarded response?
2. Render it in the web Insight builder — describe the chart. Is it usable? Legible? What happens to the browser?
3. What did the ClickHouse query cost (rows read, memory, wall time)? Did `max_execution_time` (S12) save you,
   or did it complete and just return garbage?
4. Now break down by `session_id` **and** enable interactive sampling (`"sample": true`). Does sampling *help*
   the cardinality problem, or is it orthogonal? (Hint: sampling reduces rows scanned; it does nothing about the
   number of distinct *series* — a different axis of "too big." Two guards, two problems.)

Then **delete the branch** — the damage is documented, not shipped:
```bash
git checkout lab/sprint-12 && git branch -D scratch/no-cardinality-guard
```

## Done when
You can state, with numbers: how fast the tracker detected the pathological property and with what error; exactly
what the guard returned (notice + top-N + Other) vs. what removing it returned (series count, payload size, chart
legibility, CH cost); and — in one sentence — why the cardinality guard and query sampling solve *different*
"too big" problems and neither substitutes for the other.
