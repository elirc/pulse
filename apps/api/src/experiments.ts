/**
 * Experiment registry (S14). An experiment links a flag to a hypothesis and a goal metric. The `hypothesis` is a
 * REQUIRED field on purpose — an experiment registry with a mandatory hypothesis is scientific hygiene: it forces
 * you to state what you expect *before* you look at the result, which is the whole defense against reading a
 * story into noise after the fact. Assignment is never stored (the flag buckets); we analyze exposure→goal.
 */
import { prisma } from "@pulse/db";

export interface CreateExperimentInput {
  flagKey: string;
  name: string;
  hypothesis: string;
  goalEvent: string;
}

export async function createExperiment(
  projectId: string,
  input: CreateExperimentInput,
): Promise<{ id: string } | { error: string }> {
  const flag = await prisma.featureFlag.findUnique({ where: { projectId_key: { projectId, key: input.flagKey } }, select: { id: true } });
  if (!flag) return { error: "unknown flag" };
  const exp = await prisma.experiment.create({
    data: {
      projectId,
      flagId: flag.id,
      name: input.name,
      hypothesis: input.hypothesis,
      goalEvent: input.goalEvent,
      status: "draft",
    },
    select: { id: true },
  });
  return { id: exp.id };
}

export function listExperiments(projectId: string): Promise<
  Array<{ id: string; name: string; status: string; goalEvent: string; startedAt: Date | null }>
> {
  return prisma.experiment.findMany({
    where: { projectId },
    select: { id: true, name: true, status: true, goalEvent: true, startedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Lifecycle: draft → running (stamp startedAt) → stopped (stamp stoppedAt). One-way; you don't un-run. */
export async function setExperimentStatus(
  id: string,
  status: "running" | "stopped",
): Promise<{ ok: true } | { error: string }> {
  const exp = await prisma.experiment.findUnique({ where: { id }, select: { status: true } });
  if (!exp) return { error: "not found" };
  if (status === "running" && exp.status !== "draft") return { error: "only a draft can start" };
  if (status === "stopped" && exp.status !== "running") return { error: "only a running experiment can stop" };
  await prisma.experiment.update({
    where: { id },
    data: status === "running" ? { status, startedAt: new Date() } : { status, stoppedAt: new Date() },
  });
  return { ok: true };
}
