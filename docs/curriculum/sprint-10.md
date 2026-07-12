# Curriculum Note — Sprint 10: Dashboards, Sharing & Subscriptions

Mostly fast-forward composition; the new material is **caching expensive analytical results** and the
**security shape of public sharing**. And a reminder: the same cache pattern got a *different* invalidation
answer than last course — patterns are conditional on physics.

## Learning objectives
- Cache analytical results correctly: key on the **definition**, defend against the **stampede**.
- See why a **public query endpoint's** safety is about *whose* query runs, not how the query is written.
- Learn that **invalidation strategy must match write physics** — the right answer here is the wrong answer
  elsewhere.

## Key concepts
- **📘 Cache key = definition hash, not URL.** `canonicalHash` sorts keys so the same query written two ways
  hits one entry. Keying on the request URL (or an uncanonicalized JSON blob) caches the *spelling*, not the
  *query*, and your hit rate collapses. (Meridian S12's key-order lesson, verbatim.)
- **📘 The stampede is real at analytics scale.** A 5-second query × 20 dashboard viewers at 9am Monday runs 20
  times at once — a dogpile that can take the query engine down. Single-flight (concurrent misses for one key
  await one compute) is *mandatory* here; for cheap CRUD reads it was optional. The cost of the query is what
  moves this from "nice" to "required".
- **🔍 Public endpoints: whose query runs?** A public route that executes *stored* definitions attached to the
  shared dashboard is fine. A public route that executes *request-supplied* definitions is a data-exfiltration
  API — a stranger POSTs `count(*) group by any property` and reads your whole dataset. The boundary is the
  input: stored-only, and scoped to *this* dashboard's tiles. When you review a public/unauthenticated endpoint,
  the first question is "can the caller choose what query executes?" If yes, it's a breach.
- **📘 Share tokens: entropy + constant-time.** 128-bit random, sha256 at rest, constant-time compare — the
  same hygiene as API keys, because a share token IS a bearer credential.
- **🔗 Snapshot vs live-link, stated in the footer.** A scheduled email is a point-in-time snapshot, not a live
  view. Say so, or a recipient reads last night's numbers as "now".

## The debate, cashed
**Cache invalidation on new events vs TTL-only for tiles?** Resolved: **TTL + manual refresh + staleness
badges.** Event-driven invalidation was the *right* call in a prior course (low write rate, a cheap
event→cache-key mapping). Here the write rate is 10k/s and the mapping from "an event arrived" to "which cached
tiles are now stale" is opaque and enormous — every event potentially touches every insight. So the same
pattern gets the opposite answer. *Invalidation strategies must match write physics; knowing why last course's
answer is wrong here is the whole point.*

## Exercise questions
1. Two analysts build the same trend, one orders the spec `{event, metric}`, the other `{metric, event}`. Do
   they share a cache entry? What line makes the answer "yes", and what breaks if it's missing?
2. A 4-second query and 30 people open the exec dashboard at 9:00:00. Without single-flight, what happens to the
   query engine? With it, how many times does the query run?
3. Design a public endpoint that lets a shared dashboard render trends. Now describe the one-line change that
   turns it into a data-exfiltration API, and the rule that prevents it.
4. Why is TTL-only the right invalidation here when event-driven was right in a prior course? Answer in terms of
   write rate and the invalidation mapping's cost.
5. A scheduled report shows Monday's numbers, opened Wednesday. What in the email keeps the reader from acting on
   stale data as if it were live?
6. A share token grants read access to a dashboard. List everything you'd want to know about that token's
   lifecycle before you'd call the feature production-ready. *(Hold this thought.)*
