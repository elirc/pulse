/**
 * Auto pageview capture for SPAs (S03). Client-side routers navigate with `history.pushState` and don't reload
 * the page, so a naive "capture on load" misses every route change. We patch `pushState`/`replaceState` and
 * listen for `popstate` to emit a `$pageview` on each navigation.
 *
 * Patching someone else's global is a privilege with rules:
 *   • COMPOSE, don't clobber — call the original first, then do our thing, and return its result untouched.
 *   • Be IDEMPOTENT — another Pulse copy (or a second init) must not stack patches.
 *   • Be REVERSIBLE — teardown restores `history` exactly as we found it, so we leave no trace.
 * (Other libraries patch history too; a good citizen wraps and yields, never overwrites.)
 */
const PATCH_FLAG = "__pulse_history_patched__";

/** Patch history to emit on SPA navigation. Returns a teardown that fully restores the original history. */
export function installAutoPageview(emit: () => void): () => void {
  if (typeof window === "undefined" || typeof history === "undefined") return () => {};

  const win = window as Window & { [PATCH_FLAG]?: boolean };
  if (win[PATCH_FLAG]) return () => {}; // already patched by us — idempotent, no double-emit
  win[PATCH_FLAG] = true;

  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  history.pushState = function (this: History, ..._args: Parameters<History["pushState"]>): void {
    emit();
  };
  history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>): void {
    const result = originalReplace.apply(this, args);
    emit();
    return result;
  };

  const onPopState = (): void => emit();
  window.addEventListener("popstate", onPopState);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", onPopState);
    win[PATCH_FLAG] = false;
  };
}
