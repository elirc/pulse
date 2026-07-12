-- ClickHouse events table (S07). The columnar home for the event firehose, replacing the Postgres Event table
-- for OLAP reads. Metadata (orgs, projects, persons, insights) stays in Postgres; only events move.
--
-- The ORDER BY is the single most important line: ClickHouse has no secondary indexes worth speaking of, so the
-- sort order IS the primary index, the data locality, AND the compression story (adjacent similar values
-- compress hugely). We get ONE spine — choose it from the actual query shapes (S05 insights): almost every
-- trend filters by projectId, usually by event name, always over a ts window. So: (projectId, name, ts).
--
-- Dedupe (the S04 problem, new physics): there is no unique index here. ReplacingMergeTree collapses rows with
-- the same sorting key at MERGE time (eventually), keeping the max `ingestedAt`. uuid is in the sort key so an
-- exact re-delivery is a duplicate that gets merged away. But merges are asynchronous — queries could see a
-- transient duplicate — so the consumer also keeps an in-memory insert-window set to catch the common
-- redelivery case at write time, and queries are written to avoid `FINAL` (which forces a full merge and is
-- expensive) by tolerating the rare, short-lived duplicate. "Same problem, new implementation."

CREATE TABLE IF NOT EXISTS events
(
    uuid       String,
    projectId  String,
    distinctId String,
    personId   String,
    name       String,
    props      String,          -- JSON serialized; JSONExtract* at query time
    ts         DateTime64(3),
    ingestedAt DateTime64(3)
)
ENGINE = ReplacingMergeTree(ingestedAt)
PARTITION BY toYYYYMM(ts)       -- monthly partitions: cheap to drop old data, prune by ts window
ORDER BY (projectId, name, ts, uuid);
