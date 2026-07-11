# ADR-0003 — API key model: audience-scoped capabilities

**Status:** accepted (S02) · **Deciders:** Pulse course · **Revisited:** S13 (rotation, per-key rate limits, revocation UX)

## Context

Pulse is authenticated by machines, not just humans. The SDK runs in **public browsers** and must send events
with a credential that ships in page source to strangers. Server-side integrations also need to read data back.
These are two different audiences, and conflating them is a classic, expensive mistake: a credential that a
million browsers can see must not be able to read those browsers' data.

## Decision

**Two key types, distinguished by audience, with capability following audience:**

| Type | Prefix | Audience | May |
|------|--------|----------|-----|
| WRITE  | `pw_live_…` | Public — shipped in page source | **append** events only |
| SECRET | `ps_live_…` | Server-side only | **append + read** |

- **Storage is hash + prefix.** We persist `sha256(plaintext)` and an identifiable prefix (e.g. `pw_live_ab12`).
  Keys carry 140+ bits of entropy, so a fast hash is correct — there is nothing to brute-force, so no bcrypt.
  The prefix lets support identify a key ("your `pw_live_ab12` was last used Tuesday") without ever holding it.
- **Show-once.** The plaintext is returned exactly once at issuance and never stored. There is no code path that
  can read a key back; `listKeys` never selects the hash. "Resend my key" is answered by *rotate*, not retrieve.
- **Capability is enforced, not documented.** `keyCan(type, capability)` is a small total lookup table
  (`@pulse/auth/capability.ts`). Resolving a key proves it is *valid*; the guard proves it is *allowed*. The
  events read endpoint denies a WRITE key **before any query runs**.
- **Hot-path resolution is cached.** Authenticating `POST /e` adds a lookup to every event, so the hash→key
  mapping is cached in-process with a **60s TTL**. The cost is stated out loud: **a revoked key keeps working
  for up to 60s** ("undead key"). We accept that lag on the hot path rather than a per-event DB round-trip; the
  management side can add an instant cache-bust later. `lastUsedAt` is written on a **~1% sample**, never per
  event, to avoid doubling ingest writes.
- **Two CORS policies.** Ingest (`/e`) accepts **any origin** — an analytics endpoint *wants* cross-origin
  traffic; that's the product. The app API is **same-origin** only. The danger was never CORS; it was what the
  credential allows — which the capability split handles.
- **Optional per-key origin allowlist (off by default).** Enforced only for browser-shaped requests (those with
  an `Origin` header). **This is abuse reduction, not security:** `Origin` is trivially forged outside a browser.
  We ship it, default it off, and say plainly what it does and doesn't buy — knowing the exact reach of a
  control is the point.

## Rationale

A credential's blast radius is decided by who holds it. Design the capability around the *audience* — who will
physically possess the key — not around who *should* use it. A write key is, functionally, an attacker's key
that we chose to publish; the only safe capability for it is append.

## Consequences

- Two key types to explain in onboarding, and a show-once UX that surprises users once (then teaches them).
- 60s of revocation lag on the hot path, documented and bounded, not discovered in an incident.
- **Deferred to S13:** key rotation flow, per-key rate limits, revocation listing + enumeration test, an instant
  hot-path cache-bust on revoke.
- **Links:** ADR-0001 (ingest split), ADR-0002 (Postgres-first); `@pulse/auth` (keys, capability, resolver,
  origin); the privilege-confusion arc in this PR (commits 5→6→7).
