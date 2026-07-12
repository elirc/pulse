# Curriculum Note — Sprint 9: Retention & Cohorts

Precompute vs compute-on-read is a **grid, not a religion** — place each feature on it, in writing.

## Learning objectives
- Learn the **compute-on-read vs precompute grid** (output size × scan cost × freshness) and apply it per
  feature, not by house style.
- Build a **retention triangle** and know why the cohort-size column is non-negotiable.
- Reuse **one filter AST** for two cohort kinds instead of building two query languages.
- Treat **staleness as a contract** (shown in the UI) and **derived-data churn as a signal** (logged diffs).

## Key concepts
- **📘 The decision grid (ADR-0008).** Retention: small output, tolerable scan, wants freshness → compute on
  read. Behavioral cohorts: reused by many queries, expensive to evaluate, tolerates staleness → precompute.
  Same grid, opposite corners. Deciding in writing beats "we always precompute" (wrong half the time) and "we
  never cache" (wrong the other half).
- **🔍 Staleness is a contract, not decoration.** `membersComputedAt` shown to analysts is the difference
  between a dashboard you trust and one that lies. When you precompute, the timestamp isn't optional metadata —
  it's the honesty of the whole feature.
- **📘 Derived data should explain its changes.** Every cohort recompute logs its diff (added/removed). A cohort
  that silently shrinks is an incident; the diff log is its flight recorder. If you compute something derived,
  make it able to tell you *why it changed*.
- **⚠️ Week buckets are a timezone opinion — again.** "Week 0" depends on whose Monday. Third course where
  timezones eat a sprint's error budget; the fixtures pin UTC-Monday and the project-timezone version is
  flagged. Pattern recognition complete: any time you bucket time, ask "whose midnight?".
- **📘 The retention misread.** A cohort of 3 people flashing 100% is not a win. The cohort-size column and the
  %/absolute toggle exist because a percentage without its denominator is a lie an exec will quote in a board
  deck.
- **🔗 One AST, two kinds.** Property predicates compose into behavioral definitions ("did *this event* whose
  props match *this predicate*"). Don't build a second filter language; the third appearance of the pattern.

## The debate, cashed
**Recompute behavioral cohorts on a schedule vs on event-stream triggers?** Resolved: **schedule** (hourly
default, per-cohort override). Triggers keep cohorts fresh but make every event potentially touch N cohorts —
write amplification on the hot path we spent S04 keeping dumb. *Freshness is a feature with a unit price; sell it
deliberately* — the trigger design is sketched for the customer who pays for it.

## Exercise questions
1. Place these on the grid, with reasons: (a) "trending events this hour", (b) "lifetime revenue per person",
   (c) "users active in the last 5 minutes". Which compute-on-read, which precompute?
2. A behavioral cohort's membership dropped 60% overnight. Where do you look first, and what makes that lookup
   possible?
3. Retention shows week-3 at 8%. Your PM panics. What's the first column you point at, and why might 8% be fine?
4. Property cohorts are live; behavioral are materialized. Give a behavioral cohort you'd argue *should* be live
   instead, and the cost that argument accepts.
5. Triggers vs schedule for recompute. At 5k events/s and 200 cohorts, estimate the trigger write amplification
   and say why schedule wins by default.
6. Why does a behavioral definition reuse the property filter grammar instead of a new one? Name the failure a
   second query language invites.
