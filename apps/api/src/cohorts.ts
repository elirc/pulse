/**
 * Cohort persistence + resolution (S09). Property cohorts are resolved LIVE — a predicate over the Person table,
 * cheap enough to run on demand, so it's always fresh. Behavioral cohorts read the materialized membership (the
 * scheduled job fills it). The split is ADR-0008's precompute-vs-compute-on-read grid, applied per cohort.
 */
import { prisma } from "@pulse/db";
import { personMatchesProperty, PropertyCohortSchema, type CohortSpec } from "@pulse/insights";

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

/**
 * Resolve a cohort's members (S09), the same resolver every query path uses. Property cohorts are computed LIVE
 * (fresh predicate over persons); behavioral cohorts read the MATERIALIZED membership (filled by the job). One
 * cohort definition, reused across trends/funnels/retention.
 */
export async function resolveCohortMembers(cohortId: string, projectId: string): Promise<Set<string>> {
  const cohort = await prisma.cohort.findFirst({ where: { id: cohortId, projectId }, select: { kind: true, definition: true } });
  if (!cohort) return new Set();

  if (cohort.kind === "property") {
    const spec = PropertyCohortSchema.parse(cohort.definition);
    const persons = await prisma.person.findMany({ where: { projectId }, select: { id: true, properties: true } });
    const members = new Set<string>();
    for (const p of persons) if (personMatchesProperty(p.properties as Record<string, unknown>, spec)) members.add(p.id);
    return members;
  }

  // behavioral: read the materialized membership (fresh as of membersComputedAt).
  const rows = await prisma.cohortMembership.findMany({ where: { cohortId }, select: { personId: true } });
  return new Set(rows.map((r) => r.personId));
}
