# Lab — Sprint 03: three bugs in the browser SDK

This branch (`lab/sprint-03`) deliberately breaks the SDK in three ways. Your job: reproduce each failure,
diagnose it, fix it, and prove the fix. Work against `packages/sdk`. Do **not** peek at `main` until you've
tried — the whole point is the debugging.

## How to run
```bash
pnpm install
pnpm --filter @pulse/sdk test          # two tests fail
pnpm --filter @pulse/sdk build         # then:
pnpm --filter @pulse/sdk budget        # the budget gate fails
```

## The three bugs

### Bug 1 — events dropped on a concurrent flush
`src/transport.ts`. The failing test is `does not double-send when triggers coincide`. The transport sends the
current queue but only clears it *after* the async send resolves. Two things go wrong: the same batch can be
sent twice when the size and time triggers coincide, and any event enqueued *during* the in-flight send is
wiped when the queue is cleared. **Find the ordering that makes concurrent flushes safe.** (Hint: what has to
happen synchronously, before the first `await`?)

### Bug 2 — auto-pageview breaks the host router
`src/pageview.ts`. The failing test is `emits on pushState and still runs the original`. The `pushState` patch
emits a `$pageview` but never calls the browser's original `pushState`, so the host app's client-side
navigation silently stops working — you've captured an event and swallowed the navigation. **Restore the
compose-don't-clobber contract** (and make sure the original's return value still flows back to the caller).

### Bug 3 — an accidental import busts the bundle budget
`src/enrich.ts` (imported by `src/index.ts`). Someone added a client-side "device dataset" and wired it into
the public entry point. The gzipped bundle jumps from ~2KB to ~38KB and the `budget` gate fails. **Get back
under 6KB gz.** Ask *why* this doesn't belong in a browser bundle at all — where should enrichment happen, and
which later sprint owns it?

## Done when
- `pnpm --filter @pulse/sdk test` is green,
- `pnpm --filter @pulse/sdk build && pnpm --filter @pulse/sdk budget` passes (< 6KB gz),
- and you can explain, in a sentence each, the failure mode every bug caused on a real host page.
