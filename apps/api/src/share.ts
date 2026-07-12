/**
 * Dashboard share tokens (S10). A public, read-only link to a dashboard. The token is high-entropy random
 * (128 bits), stored as a sha256 hash + an identifiable prefix (Stripe-shaped, like our API keys), and compared
 * in constant time. Shown once at creation.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@pulse/db";

export interface IssuedShareToken {
  token: string; // shown once
  prefix: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createShareToken(dashboardId: string): Promise<IssuedShareToken> {
  const token = `pst_${randomBytes(16).toString("base64url")}`; // 128 bits of entropy
  const hash = hashToken(token);
  const prefix = token.slice(0, 12);
  await prisma.shareToken.create({ data: { dashboardId, hash, prefix } });
  return { token, prefix };
}

/** Resolve a share token to its dashboardId, or null. Constant-time hash comparison. */
export async function resolveShareToken(token: string): Promise<string | null> {
  const hash = hashToken(token);
  const row = await prisma.shareToken.findUnique({ where: { hash }, select: { dashboardId: true, hash: true } });
  if (!row) return null;
  const a = Buffer.from(hash);
  const b = Buffer.from(row.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return row.dashboardId;
}
