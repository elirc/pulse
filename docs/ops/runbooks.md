# Runbooks (S15)

Operational playbooks for the on-call. Each is: **symptom → diagnose → act → verify.** Every "verify" step ends
at a *number* (the loss accounting, a count-to-zero), never "looks fine" — a pipeline in production is a promise
with a ledger.

---

## 1. Consumer lag / `lag_slo_burn`
**Symptom:** backlog climbing; lag alert firing.
**Diagnose:** check the pending list (`XPENDING`) for the insert group. Delivered-but-unacked entries piling up
= a stalled or slow consumer, *not* a poison pill (confirm `dlq_growth` is quiet). Check consumer CPU / insert
p95 — is it stalled, or just slow?
**Act:** scale the consumer group (add replicas — the group rebalances). If slow (not stalled), check ClickHouse
insert latency and disk.
**Verify:** backlog returns to baseline; run `reconcileLoss` for the incident window — **must be zero loss**.

## 2. DLQ growth / `dlq_growth`
**Symptom:** DLQ *rising* (a poison-pill storm, not a static backlog).
**Diagnose:** inspect DLQ entries — a schema-invalid payload, a foreign message, a downstream that changed shape.
Find the common cause; it's usually one bad producer or a deploy.
**Act:** fix/roll back the source. Then **replay** the DLQ via the replay path (`apps/consumer` DLQ replay) —
replay is idempotent (event uuid), so re-processing fixed messages inserts each exactly once.
**Verify:** DLQ drains to zero; the replayed events appear in CH exactly once (loss accounting balances, no
over-count).

## 3. Stalled consumer group
**Symptom:** lag climbing, DLQ flat, no inserts.
**Diagnose:** the group has delivered entries it isn't acking. Consumer crashed without graceful shutdown, or is
wedged (deadlock, blocked on CH).
**Act:** restart the group (graceful shutdown makes the *next* rollover clean; a wedged one may need a kill). New
consumers claim the stalled PEL via `XAUTOCLAIM` and reprocess — idempotency makes redelivery safe.
**Verify:** pending list empties; zero loss.

## 4. ClickHouse disk pressure / `ch_disk`
**Symptom:** CH free-disk headroom below the warn/crit threshold.
**Diagnose:** `system.parts` — which partitions are largest? Is a TTL/retention policy lagging?
**Act (in order):** (a) drop or move OLD, backed-up partitions (they're immutable and safe to detach → object
storage per `backups.md`); (b) add disk; (c) if urgent, ingest keeps 202'ing while backpressure protects the
stream — you have the backlog window to fix disk before inserts fail.
**Verify:** headroom recovers; inserts resume; **loss accounting for the pressure window is zero** (backpressure
should have prevented drops, not hidden them).

## 5. Restore (PG or CH)
**Symptom:** data corruption, accidental drop, region loss.
**Act:** follow `backups.md` — `pg_restore` for metadata; `ATTACH PARTITION` for CH events (restore only the
affected month). Do it on staging first if time allows.
**Verify:** count-to-parity against a known-good source; run the full-loop E2E query suite. Record RTO/RPO.

## 6. Write-key compromise
**Symptom:** a key leaked (public repo, log), or anomalous volume from one key (`/ops/abuse`).
**Diagnose:** identify the key by prefix; check its ingest volume and origins.
**Act:** **revoke the key** (it's a capability — revocation is immediate, per the S02 key model). Issue a
replacement to the customer. If a *share* token leaked, revoke it (`DELETE /dashboards/:id/share/:prefix`, S13).
Rotate the session secret if a session key is implicated.
**Verify:** the revoked key is rejected (401); volume from it drops to zero; check the enumeration monitor
(`share_enumeration`) for a scan that motivated the leak.

---

**The through-line:** every runbook ends at the **loss ledger**. The final question of any pipeline incident is
not "is it back up" but "did we keep every event we accepted" — and that's a number, reconciled, not a vibe.
