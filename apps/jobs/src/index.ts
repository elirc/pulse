import { Queue, Worker, type ConnectionOptions } from "bullmq";
import Redis from "ioredis";
import { createClient } from "@clickhouse/client";
import { prisma } from "@pulse/db";
import { BehavioralCohortSchema, type EventLike } from "@pulse/insights";
import { recomputeCohort, type BehavioralCohortRef } from "./recompute";
import { PrismaMembershipStore } from "./store";
import { env } from "./env";

// The process entry (not run in CI): schedule an hourly recompute of behavioral cohorts via BullMQ.
async function fetchEvents(projectId: string, windowDays: number): Promise<EventLike[]> {
  const ch = createClient({ url: env.CLICKHOUSE_URL, database: env.CLICKHOUSE_DB });
  const rs = await ch.query({
    query:
      "SELECT name, distinctId, personId, props, toUnixTimestamp64Milli(ts) AS tsMs FROM events " +
      "WHERE projectId = {pid:String} AND ts >= now() - toIntervalDay({days:UInt16})",
    query_params: { pid: projectId, days: windowDays },
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{ name: string; distinctId: string; personId: string; props: string; tsMs: string }>;
  return rows.map<EventLike>((r) => ({
    name: r.name,
    distinctId: r.distinctId,
    personId: r.personId || null,
    props: JSON.parse(r.props || "{}") as Record<string, unknown>,
    ts: new Date(Number(r.tsMs)),
  }));
}

async function runRecompute(): Promise<void> {
  const store = new PrismaMembershipStore();
  const cohorts = await prisma.cohort.findMany({ where: { kind: "behavioral" }, select: { id: true, projectId: true, definition: true } });
  for (const c of cohorts) {
    const parsed = BehavioralCohortSchema.safeParse(c.definition);
    if (!parsed.success) continue;
    const ref: BehavioralCohortRef = { id: c.id, projectId: c.projectId, spec: parsed.data };
    const events = await fetchEvents(c.projectId, parsed.data.windowDays);
    const diff = await recomputeCohort(ref, events, store);
    console.log(`cohort ${c.id}: size=${diff.size} +${diff.added.length} -${diff.removed.length}`);
  }
}

// ioredis instance as the BullMQ connection (cross-version type friction; the instance is valid at runtime).
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;
const queue = new Queue("cohort-recompute", { connection });
void queue.add("recompute", {}, { repeat: { every: env.RECOMPUTE_EVERY_MS } });
new Worker("cohort-recompute", runRecompute, { connection });
console.log(`pulse jobs — behavioral cohort recompute every ${env.RECOMPUTE_EVERY_MS}ms`);
