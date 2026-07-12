/**
 * Cohort persistence + resolution (S09). Property cohorts are resolved LIVE — a predicate over the Person table,
 * cheap enough to run on demand, so it's always fresh. Behavioral cohorts read the materialized membership (the
 * scheduled job fills it). The split is ADR-0008's precompute-vs-compute-on-read grid, applied per cohort.
 */
import { prisma } from "@pulse/db";
import { personMatchesProperty, type CohortSpec, type PropertyCohort } from "@pulse/insights";

export async function createCohort(projectId: string, name: string, spec: CohortSpec): Promise<{ id: string }> {
  return prisma.cohort.create({
    data: { projectId, name, kind: spec.kind, definition: spec as object },
    select: { id: true },
  });
}

export function listCohorts(projectId: string): Promise<
  Array<{ id: string; name: string; kind: string; membersComputedAt: Date | null; createdAt: Date }>
> {
  return prisma.cohort.findMany({
    where: { projectId },
    select: { id: true, name: true, kind: true, membersComputedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Resolve a property cohort's members live from the Person table (no materialization). */
export async function resolvePropertyCohortMembers(spec: PropertyCohort, projectId: string): Promise<Set<string>> {
  const persons = await prisma.person.findMany({ where: { projectId }, select: { id: true, properties: true } });
  const members = new Set<string>();
  for (const p of persons) {
    if (personMatchesProperty(p.properties as Record<string, unknown>, spec)) members.add(p.id);
  }
  return members;
}
