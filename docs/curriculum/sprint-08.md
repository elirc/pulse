# Curriculum Note — Sprint 8: Funnels (Dialogue Format)

Multi-step funnel analysis — the query pattern that separates analytics engineers from CRUD engineers. This
sprint is a **dialogue**: the learner authors the junior implementation (`[J]`), the senior pass rebuilds it
(`[S]`), and the naive version is kept as the fast version's conscience.

## Learning objectives
- Recognize an **N+1-at-scale** shape: correct code whose *cardinality* is the bug.
- Learn **sequence matching in one pass** (windowFunnel) and why the S07 sort key makes it fast.
- Adopt the **oracle pattern**: keep the slow-obvious implementation as the test of the fast-clever one.
- Understand that **analytics semantics are product decisions** that must live where analysts read them.

## Key concepts
- **🔍 The shape is fine; the cardinality is the bug.** J's funnel is N scans joined in JS — perfectly correct,
  and it OOMs at 4 steps × 1M persons (~40s). Always annotate a loop with its N: "for each person (1M)…". The
  review lens isn't "is this right?" (it is) but "what does this cost at our scale?" (everything). *Correct
  first, fast second is the right order* — you can't optimize what you can't first trust.
- **📘 windowFunnel thinking.** Sequence matching belongs *inside* the engine: one scan, a tiny state machine
  per person, all locality coming from the ORDER BY chosen in S07. The single-pass in-memory version is the same
  algorithm; ClickHouse's `windowFunnel()` is it at columnar speed. The S07 spine choice (`projectId, name, ts`)
  is what makes this sprint's query fast.
- **📘 The oracle pattern.** Keep the slow, obvious implementation and test the fast, clever one *against it*.
  The pair is worth more than either alone: the oracle is trustworthy because it's obvious; the fast version is
  trustworthy because it matches the oracle. `computeFunnelNaive` never ships, and it's one of the most valuable
  files in the package.
- **⚠️ Same-timestamp steps.** Two events, one millisecond — is that a sequence? Decide, document, test. Silent
  ties are how two analysts get two truths.
- **📘 The window anchors at step-1 entry.** Not the previous step. That's an explicit product decision with
  revenue implications, which is why the semantics doc is *user-facing*: a query is a contract with the analyst.
- **📘 Percentiles over means for durations.** Time-to-convert is skewed; report median and p90. Exact
  sort-and-index (the oracle) vs `quantile()` sketch (what ships) — approximate, within a contract, again.

## The debate, cashed
**Strict-order (no events between steps) vs ordered-with-gaps?** Resolved: **ordered-with-gaps** default (strict
is brutal — any pageview breaks the chain), strict as a per-funnel toggle later. *Analytics semantics are
product decisions wearing SQL costumes — write them down where analysts read.*

## Learner retro (the dialogue)
The learner's `[J]` version was correct on every fixture on the first try — which is the point. The failure
wasn't correctness; it was *not annotating the loop with its N*. Reading the same code with "× 1M persons"
written next to the loop turns "looks fine" into "OOM". The habit to build: write the cardinality next to every
iteration before you write the body.

## Exercise questions
1. J's funnel does one scan per step. Write its complexity in N (steps) and P (persons) *before* reading the
   rebuild. At P = 1M, N = 5, why does it OOM rather than just run slow?
2. `windowFunnel()` does it in one pass. What state does it keep per person, and which S07 decision makes that
   pass cheap?
3. Change the window to anchor at the *previous* step instead of step 1. Give one funnel whose reported
   conversion rate changes, and by how much.
4. Same-timestamp step-1 and step-2. State the rule this repo chose and construct the two-analysts-two-truths
   scenario it prevents.
5. Why keep `computeFunnelNaive` after shipping the fast version? What class of bug does deleting it expose you
   to later?
6. Time-to-convert p90 ≫ median. What does that tell a PM that the median alone hides?
