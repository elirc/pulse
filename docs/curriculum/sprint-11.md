# Curriculum Note — Sprint 11: Live Events & Web Analytics

Real-time analytics is a **different correctness contract**: fresh-and-lossy beats complete-and-late, and you
must write down which one each surface promises.

## Learning objectives
- Harvest flaw #4 properly — replace the bad path AND delete it.
- Reconstruct the **SSE-vs-WebSocket rule** from three courses' decisions.
- Isolate an observer with a **dedicated consumer group** so it can't slow the writer.
- Recognize the **inverted correctness contract** of live surfaces (drop-oldest, not never-drop).

## Key concepts
- **📘 A dedicated consumer group is a blast-radius boundary.** The tail reads via its own group, so a slow
  dashboard tab grows *its* pending list, never the insert consumer's. The observer must not slow the writer —
  the way you enforce that is topological (separate group), not hopeful (be fast).
- **🔗 SSE, again — reconstruct the rule.** Meridian chose SSE, Tracer chose WebSocket, Pulse chooses SSE. The
  rule that fits all three: **one-directional + HTTP-friendly + resumable → SSE**; reach for WebSocket only when
  you truly need the bidirectional channel. The tail is server→client, plain HTTP, resumable → SSE.
- **📘 Sessions are an ingest-time enrichment.** The precompute grid again: sessions are queried constantly,
  defined stably, and cheap to stamp in-stream → resolve at write, exactly like personIds (S06) and unlike
  retention (S05, read-time). Same framework, placed by the same three questions.
- **⚠️ The 30-minute gap is a default, not truth.** Session boundaries are lore-encrusted conventions. Ship it
  as a *setting with a default*, and stamp the definition version (`$session_v`) next to the data so a future
  rule change is analyzable rather than a silent history rewrite. **When you freeze a decision into data, stamp
  the decision's version next to it.**
- **📘 Small-window uniques beat HLL.** "Online now" is a sorted set by last-seen: O(log n) upkeep, ZCOUNT reads,
  self-expiring, and EXACT — because the window is small (minutes), exactness is cheap. HLL earns its
  approximation only when the cardinality is large; here it isn't.
- **📘 The inverted correctness contract.** The ingest path promises *never drop*. The live tail promises
  *fresh* — so its failure mode is drop-oldest-and-count, the exact opposite. Two surfaces, one system, opposite
  definitions of "correct". Write down which each promises, or someone will "fix" the tail to never drop and
  reintroduce the back-pressure you designed out.
- **🔍 A harvest removes the bad path.** Flaw #4's fix isn't just "add the SSE tail" — it's *deleting*
  `/events/live`. Leaving the raw-table poll as a fallback means the flaw still ships.

## The debate, cashed
**Sessions at ingest vs at query time?** Resolved: **ingest**, with the definition versioned in the event
(`$session_v: 1`) so a future change is analyzable, not silent. Query-time keeps the definition mutable but
taxes every query with reconstruction; ingest-time is cheap and stable, and the version stamp buys back the
"but the definition might change" objection. *When you freeze a decision into data, stamp the decision's version
next to it.*

## Exercise questions
1. The live tail reads via its own consumer group. Draw what happens to the INSERT consumer's pending list when
   a tail client stalls. Now draw it if they shared a group.
2. From Meridian(SSE)/Tracer(WS)/Pulse(SSE), state the rule for choosing SSE over WebSocket in one sentence.
3. Sessions are stamped at ingest. A PM wants to change the gap from 30 to 15 minutes. What does `$session_v`
   let you do that a query-time definition wouldn't?
4. "Online now" uses a sorted set, not HyperLogLog. Why is exact cheap here, and at what window size would you
   flip to HLL?
5. The ingest path never drops; the live tail drops-oldest. Are these contradictory? Explain in terms of what
   each surface promises.
6. Flaw #4's harvest deleted `/events/live`. Why is deleting it part of the fix, not an optional cleanup?
