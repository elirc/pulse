/** Prisma-backed membership store (S09): replace a cohort's membership atomically and stamp membersComputedAt. */
import { prisma } from "@pulse/db";
import type { MembershipStore } from "./recompute";

export class PrismaMembershipStore implements MembershipStore {
  async currentMembers(cohortId: string): Promise<Set<string>> {
    const rows = await prisma.cohortMembership.findMany({ where: { cohortId }, select: { personId: true } });
    return new Set(rows.map((r) => r.personId));
  }

  async replaceMembers(cohortId: string, members: Set<string>, computedAt: Date): Promise<void> {
    await prisma.$transaction([
      prisma.cohortMembership.deleteMany({ where: { cohortId } }),
      prisma.cohortMembership.createMany({ data: [...members].map((personId) => ({ cohortId, personId })) }),
      prisma.cohort.update({ where: { id: cohortId }, data: { membersComputedAt: computedAt } }),
    ]);
  }
}
