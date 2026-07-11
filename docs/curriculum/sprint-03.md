# Curriculum Note — Sprint 3: Browser SDK v1

## Learning objectives
- Build a library, not an app: code that ships to a thousand pages you don't control and can't redeploy.
- Internalize the priority ordering that makes a client SDK safe: **don't break the page > deliver the event >
  be small > be featureful.**
- Meet the **bundle budget as a CI contract** and feel why "zero dependencies" is a consequence of it, not a
  slogan.
- See where an **idempotency key** is born, and why the birthplace determines whether the pipeline can dedupe.

## Key concepts
- **📘 The event uuid is minted at capture, in the browser.** It's the id S04 dedupes on and S07 backfill leans
  on. Mint it server-side and a network retry becomes a duplicate nobody can collapse. Idempotency keys are
  minted where intent is born. (Tracer's S07 said the same about mutation ids.)
- **📘 Three flush triggers, none sufficient alone.** Size flushes a busy page; time rescues a trickle; the
  visibility/unload trigger saves the last, most valuable batch. Pick only one and you lose a whole class of
  events — pure-count strands slow pages, pure-time loses the tab close.
- **⚠️ sendBeacon is fire-and-forget.** No response to check, ~64KB budget, and it can't set headers — so the
  (public) write key rides the URL. That means it can land in access logs: treat ingest URLs as containing a
  credential and redact.
- **📘 You are a guest in someone's page.** The never-throw wrapper is not defensive politeness; it's the whole
  license to exist on a stranger's site. Even error *reporting* is wrapped, or a broken reporter re-breaks the
  page.
- **⚠️ Monkey-patching is a privilege.** Auto-pageview patches `history`; other libraries patch it too. Compose
  (call the original, return its result), be idempotent (no double-patch), be reversible (teardown restores it).
  The test that pins this is "after teardown, `history.pushState === the original".
- **📘 The bundle budget is a contract.** `check-size.mjs` fails CI past 6KB gz. Every dependency is a
  negotiation you can now see priced. This is *why* the SDK is zero-dep — not virtue, arithmetic.
- **🔗 The alias problem is named and deferred.** Events captured before `identify()` carry the anonymous id;
  stitching them to the person is genuinely hard (races, multiple devices). S06 exists largely for this.

## The debate, cashed
**Full autocapture (every click) vs explicit events + auto pageviews?** Resolved: explicit + auto pageviews now;
autocapture deferred with a design sketch, because S12's cardinality lessons are a prerequisite — magic without
guardrails floods the store with selector-soup. *Magic features have data-quality invoices; read them first.*

## Lab — `lab/sprint-03`
Three planted bugs to fix against a demo host page: (1) a flush loop that drops events when two flushes race,
(2) a `pushState` patch that breaks the host router (clobbers instead of composing), (3) a budget bust from an
accidental dependency. Drive the traffic generator / click around until each one bites, then fix and prove it.

## Exercise questions
1. Draw the lifecycle of a single event from `capture()` to a row in the events table. Mark every point where
   it could be lost, and which principle accepts that loss.
2. The uuid is minted in the browser. Give the exact duplicate-event scenario that a server-minted id would
   cause, and the sprint that would suffer for it.
3. Why can't `sendBeacon` set an `Authorization` header, and what's the logging consequence of the workaround?
4. The SDK is <6KB gz with zero deps. You're asked to add a 12KB date library for "nicer timestamps." Write the
   two-sentence rejection, grounded in the budget.
5. Auto-pageview patches `history.pushState`. Another analytics vendor on the same page does too. Describe the
   failure if both *clobber* instead of *compose*, and the one line that prevents it.
6. `maxQueue` drops the **oldest** events on overflow. Argue the opposite policy (drop newest), then say which
   you'd ship for a product-analytics tool and why.
