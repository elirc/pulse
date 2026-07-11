/**
 * The trend interpreter (S05): evaluates a TrendSpec over events in memory. This is the executable spec — the
 * golden-fixture oracle the SQL compiler must match, and a fast path for small projects. Keeping an in-memory
 * reference means "what should this query return?" is answerable without a database, and gives S07 a way to
 * check the ClickHouse results against a known-correct implementation.
 */
import { OTHER_BUCKET, type Filter, type Metric, type TrendSpec } from "./spec";

/** The minimal event shape the interpreter needs. `ts` is event time. */
export interface EventLike {
  name: string;
  distinctId: string;
  props: Record<string, unknown>;
  ts: Date;
}

export interface TrendSeries {
  label: string;
  values: number[];
}
export interface TrendResult {
  buckets: string[]; // sorted bucket keys, one per interval step present in the data
  series: TrendSeries[];
}

function matchesFilter(props: Record<string, unknown>, f: Filter): boolean {
  const actual = props[f.property];
  switch (f.op) {
    case "eq":
      return String(actual) === String(f.value);
    case "neq":
      return String(actual) !== String(f.value);
    case "contains":
      return String(actual ?? "").includes(String(f.value));
    case "gt":
      return Number(actual) > Number(f.value);
    case "gte":
      return Number(actual) >= Number(f.value);
    case "lt":
      return Number(actual) < Number(f.value);
    case "lte":
      return Number(actual) <= Number(f.value);
  }
}

function matchesAll(props: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((f) => matchesFilter(props, f));
}

/** UTC bucket key for an event time. "daily" is a timezone opinion; we bucket in UTC and revisit project-tz later. */
export function bucketKey(ts: Date, interval: TrendSpec["interval"]): string {
  const iso = ts.toISOString();
  if (interval === "month") return iso.slice(0, 7); // YYYY-MM
  if (interval === "week") {
    // ISO-ish: the Monday of this event's week, in UTC.
    const d = new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()));
    const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }
  return iso.slice(0, 10); // YYYY-MM-DD
}

function metricValue(events: EventLike[], metric: Metric): number {
  if (metric === "unique") return new Set(events.map((e) => e.distinctId)).size;
  return events.length;
}

function labelOf(value: unknown): string {
  return value === undefined || value === null ? "(none)" : String(value);
}

export function computeTrend(
  events: EventLike[],
  spec: TrendSpec,
  now: () => Date = () => new Date(),
): TrendResult {
  const cutoff = new Date(now().getTime() - spec.days * 24 * 60 * 60 * 1000);
  const filtered = events.filter(
    (e) =>
      (spec.event === undefined || e.name === spec.event) && e.ts >= cutoff && matchesAll(e.props, spec.filters),
  );

  // grid[bucket][label] = events
  const grid = new Map<string, Map<string, EventLike[]>>();
  const bucketSet = new Set<string>();
  for (const e of filtered) {
    const bucket = bucketKey(e.ts, spec.interval);
    bucketSet.add(bucket);
    const label = spec.breakdown ? labelOf(e.props[spec.breakdown]) : (spec.event ?? "All events");
    let row = grid.get(bucket);
    if (!row) grid.set(bucket, (row = new Map()));
    const cell = row.get(label);
    if (cell) cell.push(e);
    else row.set(label, [e]);
  }
  const buckets = [...bucketSet].sort();

  if (!spec.breakdown) {
    const label = spec.event ?? "All events";
    const values = buckets.map((b) => metricValue([...(grid.get(b)?.values() ?? [])].flat(), spec.metric));
    return { buckets, series: [{ label, values }] };
  }

  // Breakdown: rank labels by total metric across the window, keep top-N, fold the rest into "Other".
  const totals = new Map<string, number>();
  for (const row of grid.values()) {
    for (const [label, evs] of row) totals.set(label, (totals.get(label) ?? 0) + metricValue(evs, spec.metric));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  const top = ranked.slice(0, spec.topN);
  const tail = ranked.slice(spec.topN);

  const series: TrendSeries[] = top.map((label) => ({
    label,
    values: buckets.map((b) => metricValue(grid.get(b)?.get(label) ?? [], spec.metric)),
  }));
  if (tail.length > 0) {
    series.push({
      label: OTHER_BUCKET,
      values: buckets.map((b) => metricValue(tail.flatMap((l) => grid.get(b)?.get(l) ?? []), spec.metric)),
    });
  }
  return { buckets, series };
}
