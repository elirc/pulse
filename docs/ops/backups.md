# Backup & restore — two datastores, two procedures, one drill (S15)

Pulse persists to **two** stores with very different backup physics, and conflating them is how you discover at
restore time that your "backup" doesn't restore. This documents both side by side, and the staging restore drill
that proves each one actually works — a backup you have never restored is a hope, not a backup.

| | Postgres (metadata) | ClickHouse (events) |
|---|---|---|
| **What's in it** | projects, keys, persons, cohorts, dashboards, flags, experiments, deletion ledger | the append-only event firehose (billions of rows) |
| **Size** | small (MB–GB) | large (TB) |
| **Backup unit** | logical dump / PITR (WAL) | **partition** (monthly parts) |
| **Tool** | `pg_dump` / `pg_basebackup` + WAL archiving | `ALTER TABLE … FREEZE PARTITION` → copy `shadow/` |
| **Restore** | `pg_restore` (or replay WAL to a point in time) | `ATTACH PARTITION` from a frozen copy |

## Postgres (metadata) — logical + PITR
```bash
# Nightly logical dump (fast to restore small, portable across versions).
pg_dump --format=custom --file=pulse-$(date +%F).dump "$DATABASE_URL"

# Restore:
pg_restore --clean --if-exists --dbname="$DATABASE_URL" pulse-2026-07-11.dump
```
For point-in-time recovery, archive WAL (`archive_command`) and `pg_basebackup` weekly; restore = base backup +
replay WAL to a target time. Metadata is small and correctness-critical (keys, the deletion ledger), so we keep
BOTH a nightly logical dump and continuous WAL.

## ClickHouse (events) — partition-level, NOT pg_restore
Columnar backup physics: you do **not** dump-and-reload billions of rows. The events table is partitioned by
month (`PARTITION BY toYYYYMM(ts)`), and the **partition is the backup and restore unit**.
```sql
-- Freeze a month into the table's shadow/ directory (a hard-link snapshot; cheap, no data copy).
ALTER TABLE events FREEZE PARTITION '202607';
-- Ship the frozen files (shadow/<N>/data/…) to object storage.
```
```sql
-- Restore: place the frozen part files into detached/, then attach.
ALTER TABLE events ATTACH PARTITION '202607';
```
Because partitions are independent, you can restore **one month** without touching the rest — and a corrupted or
mistakenly-dropped recent partition is a targeted `ATTACH`, not a full-table reload. Old, immutable partitions
(the ADR-0002/0007 "historical values never change" property) can be frozen once and never re-backed-up.

## The staging restore drill (evidence, not faith)
Run monthly on staging; attach the output here as evidence.
1. Take a fresh PG dump + FREEZE the current CH partition from prod (or a prod-shaped fixture).
2. On a clean staging cluster: `pg_restore` the dump; `ATTACH PARTITION` the frozen CH part.
3. **Verify by count-to-parity**, not "it didn't error":
   - `SELECT count(*) FROM persons` (PG) matches the source.
   - `SELECT count() FROM events WHERE toYYYYMM(ts) = 202607` (CH) matches the source partition's row count.
   - Run the full-loop E2E query suite against the restored stores.
4. Record RTO (time to restore) and RPO (data-loss window from last backup). A restore drill that finds nothing
   was rehearsed, not run — note what you'd change.

## Deploy safety for schema changes
- **Additive first.** New columns nullable/defaulted; new tables independent. Prisma migrations are
  forward-compatible so a rolling deploy (old + new code briefly coexisting) never sees a missing column.
- **CH is append-only:** never `ALTER … MODIFY COLUMN` on the hot events table under load; add a new column and
  backfill via a partition-scoped mutation off-peak.
- **Expand → migrate → contract** for any breaking change: add the new shape, dual-write/backfill, cut over, then
  remove the old — the same pattern S07's PG→CH migration used, generalized.
