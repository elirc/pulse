/**
 * Sessions (S02) — a FAST-FORWARD. Org/user login is assumed known from prior courses, so this is the
 * smallest honest implementation: a stateless HMAC-signed token carrying who you are and which org you're
 * acting in. Not the teaching focus of this sprint (machine auth is), but real enough that the management
 * API has something to authenticate a human against, as opposed to a machine key.
 *
 * A session authenticates a PERSON in a browser; an API key authenticates a MACHINE. They are different
 * audiences and — the whole point of S02 — must map to different capabilities. Keeping them in separate
 * modules keeps that distinction from blurring.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface Session {
  userId: string;
  orgId: string;
  role: "owner" | "admin" | "member";
  /** Expiry, epoch ms. */
  exp: number;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

function hmac(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** Sign a session into a `<payload>.<sig>` token. `ttlMs` defaults to 7 days. */
export function signSession(
  session: Omit<Session, "exp"> & { exp?: number },
  secret: string,
  now: () => number = Date.now,
): string {
  const exp = session.exp ?? now() + 7 * 24 * 60 * 60 * 1000;
  const payload = b64url(Buffer.from(JSON.stringify({ ...session, exp })));
  const sig = b64url(hmac(secret, payload));
  return `${payload}.${sig}`;
}

/**
 * Verify a token and return the Session, or `null` on any failure (bad shape, bad signature, expired).
 * Signature check is constant-time — a token is attacker-controlled input; never `===` a MAC.
 */
export function verifySession(token: string, secret: string, now: () => number = Date.now): Session | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = b64url(hmac(secret, payload));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: Session;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
  } catch {
    return null;
  }
  if (typeof parsed.exp !== "number" || parsed.exp <= now()) return null;
  return parsed;
}
