# Sprint 02 — Orgs, Projects & API Keys

**Branch:** `sprint-02/projects-keys` · **Size:** M · Ritual: [00-workflow.md](00-workflow.md)

**Goal:** Fast-forward org/user auth; the new material is **machine auth**: public write keys (shipped in page source to strangers) vs secret keys (server-side), key hashing, CORS for arbitrary origins, and a privilege-confusion arc.

## A — Issues
1. `Org/user auth + Project model (fast-forward)`
2. `ApiKey: public write key + secret key; hashed at rest; per-project`
3. `Ingest auth via write key; management API via secret key or session`
4. `CORS policy for /e (any origin) + project setup page with snippet`

## B — Commits
| # | Commit | Notes |
|---|--------|------|
| 1 | `feat(db): Org, User, Project, ApiKey (type WRITE|SECRET, hash, prefix, lastUsedAt)` | key format `pw_live_…` / `ps_live_…` — type readable from prefix |
| 2 | `feat(api): sessions + org auth (fast-forward from Meridian S2)` | |
| 3 | `feat(api): key issuance — show-once, store hash, prefix for identification` | ⚠️ show-once UX: the key exists in plaintext for one response |
| 4 | `feat(ingest): write-key auth on /e — hash lookup, project resolution, lastUsedAt sampling` | lookup cached in-process (TTL); per-request DB hit would own the hot path |
| 5 | `feat(api): events read endpoint — [accepts any valid key]` | **[fix-later-in-PR]** write key grants read |
| 6 | `test(api): privilege confusion — write key reads events, FAILS the spec` | the attack: write keys are *public* (view-source); a public key must never read data |
| 7 | `fix(api): key-type enforcement middleware — write keys write, secret keys read` | typed guards per route class; matrix test |
| 8 | `feat(ingest): CORS — /e accepts any origin (that's the product); management API stays same-origin` | two CORS policies in one system, each argued |
| 9 | `feat(web): project setup page — snippet with write key, onboarding checklist` | |
| 10 | `test(e2e): create project → copy snippet → curl an event → appears in daily counts` | |
| 11 | `docs: ADR-0003 API key model; curriculum note` | |

## C — Review order
Key model (1, 3) → the confusion arc (5→6→7) → the two CORS policies (8).

## D — Teaching comments (~9)
- key prefixes — 📘 identifiable-but-secret: prefix for support/debugging, hash for storage; same design as Stripe's keys, and why
- show-once — 📘 if you can show it twice you stored it wrong
- hot-path key cache — 🔗 first hot-path decision: auth adds a lookup to *every* event; TTL cache with revocation lag named explicitly (60s of undead key, accepted and documented)
- privilege confusion — ⚠️ the class: credentials that differ in *audience* must differ in *capability*; a write key lives in public page source — treat it as an attacker's key that may only append
- CORS for /e — 📘 an analytics endpoint *wants* cross-origin traffic; the danger isn't CORS, it's what the credential allows (see arc)
- lastUsedAt sampling — 🔍 review-lens: writing on every event doubles ingest writes; sample it (1%) — first taste of the sampling mindset

## E — Debate
**"Domain allowlist per write key?"** Yes: limits key abuse from other sites. No: Origin is spoofable outside browsers anyway; adds setup friction. **Resolution:** optional allowlist, off by default, enforced only for browser-shaped requests — and the honest ADR note: it's abuse *reduction*, not security. Lesson: *know exactly what a control does and doesn't buy you; say so in writing.*

## F/G — Close
- Squash: `feat(sprint-02): projects, api keys, ingest auth (closes #…)`
- Deferred: key rotation flow, per-key rate limits (→ S13).
- Recap idea: *machine credentials have audiences — design capability around who will hold them, not who should.*
