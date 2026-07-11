/**
 * The never-throw boundary (S03). You are a guest in someone else's page. A bug in an analytics library must
 * never take down a customer's checkout flow — so every public entry point runs inside `guard`, which swallows
 * any error and (optionally) reports it through the host-supplied `onError`. Even the reporting is wrapped: an
 * onError that throws must not re-break the page. This policy is the reason the SDK can be pasted into a
 * hostile, unknown environment and be trusted to fail quietly instead of loudly.
 */
export function guard(fn: () => void, onError?: (error: unknown) => void): void {
  try {
    fn();
  } catch (error) {
    try {
      onError?.(error);
    } catch {
      /* reporting is best-effort; never let it throw into the page */
    }
  }
}
