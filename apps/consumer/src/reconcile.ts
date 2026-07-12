/**
 * Reconciliation (S07, Act 3): never cut over on faith. Count both sides and publish the diff. This computes
 * per-day event counts and per-project unique persons on Postgres (truth) and ClickHouse (shadow) and reports
 * every day/project where they disagree. A migration is PROVEN by reconciliation, not believed.
 */
export interface EventRow {
  ts: string; // ISO
  projectId: string;
  personId: string;
}

export interface DayDrift {
  day: string;
  pg: number;
  ch: number;
}

export interface ReconcileResult {
  countDrift: DayDrift[];
  uniqueDrift: Array<{ projectId: string; pg: number; ch: number }>;
  ok: boolean;
}

function perDayCounts(rows: EventRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const day = r.ts.slice(0, 10);
    m.set(day, (m.get(day) ?? 0) + 1);
  }
  return m;
}

function perProjectUniques(rows: EventRow[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = m.get(r.projectId);
    if (!s) m.set(r.projectId, (s = new Set()));
    s.add(r.personId);
  }
  return m;
}

export function reconcile(pg: EventRow[], ch: EventRow[]): ReconcileResult {
  const pgDays = perDayCounts(pg);
  const chDays = perDayCounts(ch);
  const countDrift: DayDrift[] = [];
  for (const day of new Set([...pgDays.keys(), ...chDays.keys()])) {
    const p = pgDays.get(day) ?? 0;
    const c = chDays.get(day) ?? 0;
    if (p !== c) countDrift.push({ day, pg: p, ch: c });
  }

  const pgU = perProjectUniques(pg);
  const chU = perProjectUniques(ch);
  const uniqueDrift: Array<{ projectId: string; pg: number; ch: number }> = [];
  for (const projectId of new Set([...pgU.keys(), ...chU.keys()])) {
    const p = pgU.get(projectId)?.size ?? 0;
    const c = chU.get(projectId)?.size ?? 0;
    if (p !== c) uniqueDrift.push({ projectId, pg: p, ch: c });
  }

  countDrift.sort((a, b) => a.day.localeCompare(b.day));
  return { countDrift, uniqueDrift, ok: countDrift.length === 0 && uniqueDrift.length === 0 };
}
