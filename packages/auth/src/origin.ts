/**
 * Per-key origin allowlist (S02 debate resolution).
 *
 * The honest scope of this control, written down so nobody mistakes it for more than it is: it reduces ABUSE
 * of a leaked write key from *other websites in a browser*. It is NOT security — `Origin` is a request header,
 * trivially forged by anything that isn't a browser (curl, a script, a server). So we enforce it ONLY for
 * browser-shaped requests (those that carry an Origin), and we default it OFF (empty = allow any origin).
 *
 * Knowing exactly what a control does and does not buy you — and saying so — is the whole lesson of the debate.
 */
export function originAllowed(allowedOrigins: string[] | undefined, origin: string | null): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) return true; // no allowlist configured → allow all
  if (origin === null) return true; // not a browser request; the allowlist only constrains browsers
  return allowedOrigins.includes(origin);
}
