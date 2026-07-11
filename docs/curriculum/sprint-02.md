# Curriculum Note — Sprint 2: Orgs, Projects & API Keys

## Learning objectives
- Fast-forward the boilerplate (orgs, users, sessions, projects) and spend the attention on the new material:
  **machine authentication**.
- Internalize the sprint's one invariant: **a credential's capability follows its audience.**
- See a **privilege-confusion** bug planted, proven with a failing test, and fixed with a capability guard —
  the review-lens for a whole class of auth defects.
- Meet the course's **first hot-path cost decision** (auth adds a lookup to every event) and the honest
  trade-off that answers it (a TTL cache with bounded, documented revocation lag).

## Key concepts
- **📘 Identifiable, but secret.** Store `sha256(plaintext)` + a readable prefix (`pw_live_ab12`), never the key.
  The prefix is for support/debugging; the hash is for verification. Same shape as Stripe's keys, for the same
  reason. Random 140-bit keys don't need bcrypt — there's nothing to brute-force.
- **📘 Show-once.** If you can show a key twice, you stored it wrong. Issuance returns the plaintext exactly
  once; "resend" is *rotate*, not retrieve.
- **⚠️ Privilege confusion — the class.** Credentials that differ in **audience** must differ in **capability**.
  A WRITE key lives in public page source; treat it as an attacker's key that may only append. The endpoint
  that accepted *any valid key* let a stranger read a project's events with a credential we published on
  purpose. The fix isn't "validate harder" — it's separating *valid* (is it real?) from *allowed* (may it do
  this?).
- **🔗 The first hot-path decision.** Authenticating `POST /e` adds a credential lookup to **every event**. A
  per-request DB round-trip would make auth the bottleneck before storage is. So we cache hash→key in-process
  with a 60s TTL — and write down the cost: **up to 60s of "undead key"** after revocation. Naming the lag is
  the senior move; discovering it in an incident is the junior one.
- **🔍 Sample the metadata.** Writing `lastUsedAt` on every event would double ingest writes. Sample it (~1%).
  First taste of the sampling mindset that returns in force in S12.
- **📘 Two CORS policies, each argued.** Ingest wants any origin (that's the product); the app API is
  same-origin. The danger was never CORS — it was capability, already solved.

## The debate, cashed
**Domain allowlist per write key?** Resolved: ship it, **off by default**, enforced only for browser-shaped
requests — and say in writing that it's **abuse reduction, not security** (Origin is spoofable outside a
browser). *Know exactly what a control does and doesn't buy you, and write it down.*

## The planted flaw (harvested inside this PR)
Commit 5 adds an events read endpoint that accepts **any** valid key. Commit 6 is a **failing** test asserting a
write key must never read. Commit 7 adds the capability guard and the test goes green — DB-free, because the
guard denies before any query. Read those three commits in order; that is the shape of a good security fix.

## Exercise questions
1. A support engineer asks you to "just email me the customer's write key so I can test." Give the two-sentence
   answer and the alternative.
2. The resolver caches keys for 60s. Draw the timeline of a compromised key from `revoke` to fully-dead. Where
   would you add an instant kill, and what does it cost on the hot path?
3. Why does a WRITE key get `append` but not `read`, while a SECRET key gets both? Construct the attack that the
   asymmetry prevents, starting from "view-source".
4. `lastUsedAt` is sampled at ~1%. If a key is used 10,000 times/day, roughly how fresh is its `lastUsedAt`?
   When would 1% be too coarse, and what would you change?
5. The origin allowlist is "abuse reduction, not security." Write the one-line incident post-mortem sentence you
   would *not* want to write because you mistook it for security.
6. `POST /e` didn't change when we added the `EventSink` seam. Name the two later sprints that swap what's behind
   it, and what each swaps it to.
