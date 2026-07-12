# Funnel Semantics (for analysts)

A funnel query is a **contract**: "conversion" has to mean exactly one thing, or two people run the same funnel
and get two answers. This page is that contract. (Engineers: the fixtures in `packages/insights/src/funnel-*.test.ts`
enforce every rule here.)

## What a funnel counts
Given ordered steps `A → B → C` and a conversion window:

1. **Step 1 is the anchor.** A person "enters" the funnel at their **earliest** step-1 event within the lookback
   window. That timestamp anchors everything.
2. **The window is measured from step 1**, not from the previous step. If the window is 7 days, step C must occur
   within 7 days of step **A** — not within 7 days of step B. (This is a product decision with revenue
   implications; see the debate.)
3. **Order matters; gaps don't** (ordered-with-gaps). Steps must occur in sequence in time, but other events may
   happen in between. `A … (anything) … B` counts. `B … A` does **not** — doing signup before your first view
   leaves you stuck at step 1.
4. **The window edge is inclusive.** A conversion at *exactly* anchor + window counts; one millisecond later
   does not.
5. **Same-timestamp steps** advance in the order the events are recorded. A genuine tie is resolved by that
   order, deterministically — never by chance.

## What a funnel reports
- **Per-step count** and two conversion rates: from **start** (step 1) and from the **previous** step. Read the
  from-previous rates to find *where* people drop; read from-start for the headline.
- **Time-to-convert**: median **and p90**, over people who completed the whole funnel. Medians lie less than
  means for skewed durations; p90 shows the slow tail.
- **Breakdown**: split the funnel by a property (e.g. `$browser`), top-N groups.

## Not yet supported (deferred)
- **Exclusion steps** ("converted *without* doing X").
- **Strict-order** funnels (no other events between steps) — filed; ordered-with-gaps is the default because a
  stray pageview shouldn't break every chain.
- **Funnel trends over time** (conversion rate week over week).

## Why this page exists
Queries are contracts with analysts. "Conversion window anchors at step 1" vs "at the previous step" changes
your reported conversion rate — silently, if it isn't written down. Analytics semantics are product decisions
wearing SQL costumes; this is where the costume comes off.
