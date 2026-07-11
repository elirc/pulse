/**
 * Identity primitives (S03). The event `uuid` is minted HERE — in the browser, at the moment the event is
 * created — not server-side. That is the whole idempotency story of the pipeline: the id is born with the
 * intent, so a retried send (transport.ts) and a re-backfilled row (S07) carry the SAME id and can be deduped.
 * Mint it downstream and a network retry becomes a duplicate event nobody can collapse. (Tracer's S07 made the
 * same argument about mutation ids: idempotency keys are minted where intent is born.)
 */

/** RFC-4122-ish v4 id: crypto.randomUUID where available, else a getRandomValues fallback. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
