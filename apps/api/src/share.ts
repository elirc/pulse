/**
 * Dashboard share tokens (S10 + S13). A public, read-only link to a dashboard. The token is high-entropy random
 * (128 bits), stored as a sha256 hash + an identifiable prefix (Stripe-shaped, like our API keys), and compared
 * in constant time. Shown once at creation.
 *
 * S13 (harvests flaw #5): links now EXPIRE (default 90d) and can be REVOKED, and failed lookups feed an
 * enumeration monitor. The validity decision lives in the pure `share-policy` module (CI-tested); this file is
 * the Postgres-bound plumbing around it.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@pulse/db";
import { evaluateShareToken, EnumerationMonitor, SHARE_TOKEN_TTL_MS } from "./share-policy";

export interface IssuedShareToken {
  token: string; // shown once
  prefix: string;
  expiresAt: Date;
}

/** Process-wide enumeration monitor for prefix-scanning attempts on the public path. */
export const shareEnumerationMonitor = new EnumerationMonitor();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createShareToken(
  dashboardId: string,
  ttlMs: number = SHARE_TOKEN_TTL_MS,
): Promise<IssuedShareToken> {
  const token = `pst_${randomBytes(16).toString("base64url")}`; // 128 bits of entropy
  const hash = hashToken(token);
  const prefix = token.slice(0, 12);
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.shareToken.create({ data: { dashboardId, hash, prefix, expiresAt } });
  return { token, prefix, expiresAt };
}

/** Revoke a share token by its public prefix. Returns how many links were killed (0 if the prefix is unknown). */
export async function revokeShareToken(dashboardId: string, prefix: string): Promise<number> {
  const res = await prisma.shareToken.updateMany({
    where: { dashboardId, prefix, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

/**
 * Resolve a share token to its dashboardId, or null. Constant-time hash comparison, THEN the policy check
 * (revoked/expired). A failed lookup is recorded against `source` for enumeration monitoring.
 */
export async function resolveShareToken(token: string, source = "unknown"): Promise<string | null> {
  const hash = hashToken(token);
  const row = await prisma.shareToken.findUnique({
    where: { hash },
    select: { dashboardId: true, hash: true, revokedAt: true, expiresAt: true },
  });
  if (!row) {
    shareEnumerationMonitor.recordMiss(source);
    return null;
  }
  const a = Buffer.from(hash);
  const b = Buffer.from(row.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    shareEnumerationMonitor.recordMiss(source);
    return null;
  }
  const verdict = evaluateShareToken(
    { dashboardId: row.dashboardId, revokedAt: row.revokedAt, expiresAt: row.expiresAt },
    new Date(),
  );
  if (!verdict.valid) {
    // A revoked/expired token is a miss too — probing an expired link shouldn't be a blind spot.
    shareEnumerationMonitor.recordMiss(source);
    return null;
  }
  return verdict.dashboardId;
}
