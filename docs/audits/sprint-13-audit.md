# Sprint 13 audit — pipeline hardening & data-subject rights

*Drafted by the learner from the audit-harness runs; annotated by the course (📎).* This is the **audit-first**
sprint: the pipeline is the attack surface, and every fix that follows cites a finding here. Severities are
P1 (fix this sprint, correctness/legal), P2 (fix this sprint, abuse/privacy), P3 (fast-forward hardening).

## How the evidence was gathered
- **Chaos harness** — `loadgen` driven to emit duplicate, reordered, and clock-skewed events (timestamps from
  1970 and 2031) against the ingest endpoint at 500 evt/s for 2 min.
- **SDK outage sim** — backend returns 503 for 10 minutes with 200 simulated tabs open, then recovers; request
  arrival rate sampled per second across the recovery.
- **Write-key abuse probe** — a single write key replayed at 5,000 evt/s from one origin.
- **PII sweep** — grep of a 10k-event sample and the ingest/api logs for emails, IPs, and `pst_`/`pw_` key
  material.
- **Share-token probe** — issue a token, then attempt reuse after 90 days and sequential-prefix enumeration.
- `pnpm audit` + a gitleaks pass over the full history.

---

## P1 findings (correctness / legal — fix this sprint)

### F1 — SDK retry storm on recovery (thundering herd)
**Where:** `packages/sdk/src/transport.ts` → `withRetry`.
**Evidence:** during the outage sim, the moment the backend returned, arrival rate spiked to **~40× steady
state** for ~3 s, then rang. Every tab had backed off to the *same* `baseMs · 2^n` boundary and fired in
lockstep. There is no random jitter and **no cap** — after enough failures the delay is still deterministic, so
all clients remain phase-locked.
📎 *Synchronized retries are a self-inflicted DDoS: the outage's second victim is the recovery.* This is a
ten-sprint-old decision surfacing under load — see the flaw ledger, revealed at this sprint's recap.

### F2 — Ingest trusts client timestamps unconditionally
**Where:** `apps/ingest/src/server.ts` (`ts: eventTime(input.ts)`), `packages/shared` `eventTime`.
**Evidence:** skewed events landed in buckets **"from 2031"** and **"from 1970"**, corrupting daily trends and
retention cohorts. The client clock is both attacker-controlled (trivial to forge `ts`) and innocently wrong
(dead phone batteries, bad NTP). Nothing clamps it.
📎 *Analytics correctness is a time-trust question.* The event log is only as honest as the least-trustworthy
clock allowed to write to it.

### F3 — No verified deletion path (GDPR Art. 17)
**Where:** system-wide. There is **no** person-delete API. Events are append-only in ClickHouse; a person's
rows also exist in Postgres metadata, cohort materializations (S09), and the **tile result cache (S10)**.
**Evidence:** a data-subject deletion request today has no mechanism and no proof of completion. The tile cache
would keep serving a "deleted" person's aggregates until TTL.
📎 *A deletion feature is a data-inventory audit in disguise — you must enumerate every copy, or you haven't
deleted anything.*

---

## P2 findings (abuse / privacy — fix this sprint)

### F4 — Share tokens never expire and can't be revoked
**Where:** `apps/api/src/share.ts` → `createShareToken`.
**Evidence:** a token issued 90 days ago still resolved. There is no `expiresAt`, no revocation list, and no
monitoring for sequential-prefix enumeration attempts. A link leaked once is public forever.

### F5 — No per-key rate limiting on ingest
**Where:** `apps/ingest` `/e`. **Evidence:** one write key sustained 5,000 evt/s from a single origin with no
throttle — S02 explicitly deferred this. A compromised or buggy key can drown the pipeline and the bill.

### F6 — PII reaches storage and logs unscrubbed
**Where:** ingest accepts arbitrary `props`; logs echo the request. **Evidence:** the sample contained raw
`email` property values, and the ingest access log recorded the **write key in the URL** (the S03 `sendBeacon`
path puts it in the query string). What lands unscrubbed can leak later.

---

## P3 findings (fast-forward hardening)

### F7 — No secret/dependency gates in CI
**Where:** `.github/workflows`. **Evidence:** `pnpm audit` flags transitive advisories; no gitleaks stage. No
automated guard against a committed secret or a known-vuln dependency.

---

## Remediation map (→ commits)
| Finding | Sev | Fix commit |
|---|---|---|
| F1 SDK herd | P1 | 2 — jitter + cap + circuit breaker |
| F2 client ts | P1 | 3 — server-authoritative time, ±48h clamp + `$ts_clamped` |
| (F1/F2 regression) | P1 | 4 — chaos suite as permanent CI stage |
| F5 rate limit | P2 | 5 — token-bucket per write key |
| F4 share tokens | P2 | 6 — expiry + revocation + enumeration monitor |
| F6 PII | P2 | 7 — scrub-at-ingest + log redaction |
| F3 deletion | P1 | 8, 9 — person-delete API + completeness test |
| F7 CI gates | P3 | 10 — gitleaks + dependency gates |

*Three adversaries recur across these findings: the network (F1, F5), the clock (F2), and the law (F3, F4, F6).*
