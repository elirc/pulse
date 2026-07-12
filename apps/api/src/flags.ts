/**
 * Feature-flag persistence + payload (S14). Flags are stored as their AST (variants + rollout + targeting) and
 * shipped to SDKs as a payload the SDK evaluates locally. No per-user assignment is ever written — the flag's
 * deterministic bucketing decides the variant wherever it's evaluated.
 */
import { prisma } from "@pulse/db";
import { FlagSpecSchema, type FlagSpec } from "@pulse/flags";

export async function createFlag(projectId: string, spec: FlagSpec): Promise<{ id: string; key: string }> {
  return prisma.featureFlag.create({
    data: {
      projectId,
      key: spec.key,
      enabled: spec.enabled,
      rolloutPercentage: Math.round(spec.rolloutPercentage),
      variants: spec.variants as object,
      targeting: spec.targeting as object,
    },
    select: { id: true, key: true },
  });
}

export function listFlags(projectId: string): Promise<
  Array<{ id: string; key: string; enabled: boolean; rolloutPercentage: number; createdAt: Date }>
> {
  return prisma.featureFlag.findMany({
    where: { projectId },
    select: { id: true, key: true, enabled: true, rolloutPercentage: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** The SDK payload: every flag definition for a project, parsed back into the AST the SDK evaluates. */
export async function flagPayload(projectId: string): Promise<FlagSpec[]> {
  const rows = await prisma.featureFlag.findMany({ where: { projectId } });
  return rows.map((r) =>
    FlagSpecSchema.parse({
      key: r.key,
      enabled: r.enabled,
      rolloutPercentage: r.rolloutPercentage,
      variants: r.variants,
      targeting: r.targeting,
    }),
  );
}
