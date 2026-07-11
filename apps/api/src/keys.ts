/**
 * Key issuance + listing (S02), the Prisma-backed edge over @pulse/auth's pure primitives.
 *
 * `issueKey` is the show-once moment: we mint a key, persist ONLY its hash + prefix, and return the plaintext a
 * single time. There is deliberately no code path anywhere that can read a plaintext back — `listKeys` never
 * selects the hash, let alone the secret. If a support flow ever needs "resend my key", the answer is rotate,
 * not retrieve.
 */
import { prisma, ApiKeyType } from "@pulse/db";
import { generateApiKey, type KeyType } from "@pulse/auth";

export interface IssuedKey {
  id: string;
  type: KeyType;
  prefix: string;
  /** The plaintext — returned ONCE, never persisted, never returned again. */
  plaintext: string;
}

/** Verify the acting org actually owns the project before touching its keys. */
export async function assertProjectInOrg(projectId: string, orgId: string): Promise<boolean> {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  return project !== null;
}

export async function issueKey(projectId: string, type: KeyType, label: string): Promise<IssuedKey> {
  const k = generateApiKey(type);
  const row = await prisma.apiKey.create({
    data: { projectId, type: type as ApiKeyType, hash: k.hash, prefix: k.prefix, label },
    select: { id: true },
  });
  return { id: row.id, type, prefix: k.prefix, plaintext: k.plaintext };
}

/** List a project's keys for the settings UI — prefixes only. The hash is never selected; plaintext is gone. */
export function listKeys(projectId: string): Promise<
  Array<{ id: string; type: ApiKeyType; prefix: string; label: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }>
> {
  return prisma.apiKey.findMany({
    where: { projectId },
    select: { id: true, type: true, prefix: true, label: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}
