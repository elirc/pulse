-- Daily rollups (S12) — the ~70% of query load the audit found is hot AND stable: daily counts and daily
-- unique persons per project/event. A materialized view maintains them incrementally as events insert, so the
-- common dashboard queries read a handful of pre-aggregated rows instead of scanning the raw firehose.
--
-- AggregatingMergeTree stores partial aggregation STATES (not final values), merged at read with *Merge
-- functions. `uniqState`/`uniqMerge` is the key trick: unique-person counts are NOT summable across days, so we
-- store the HyperLogLog *state* per day and merge states at query time to get any range's uniques — the same
-- approximate-distinct contract as S07, now pre-materialized.

CREATE TABLE IF NOT EXISTS events_daily
(
    projectId String,
    name      String,
    day       Date,
    count     AggregateFunction(sum, UInt64),
    uniqs     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
ORDER BY (projectId, name, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS events_daily_mv TO events_daily AS
SELECT
    projectId,
    name,
    toDate(ts)                                            AS day,
    sumState(toUInt64(1))                                 AS count,
    uniqState(if(personId != '', personId, distinctId))   AS uniqs
FROM events
GROUP BY projectId, name, day;

-- Read pattern (what the router emits for an eligible query):
--   SELECT day, sumMerge(count) AS value FROM events_daily
--   WHERE projectId = {pid} AND name = {ev} AND day >= today() - {days}
--   GROUP BY day ORDER BY day;
-- (uniqMerge(uniqs) for the unique metric.)
