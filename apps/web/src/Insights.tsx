/**
 * Insight builder (S05). Pick an event, a metric, an interval, and an optional breakdown; the API compiles the
 * spec to parameterized SQL and returns flat { bucket, label, value } rows, which we pivot into a grouped bar
 * chart. Saving persists the query DEFINITION, not the numbers (so S07 can swap the backend under it).
 */
import { useState } from "react";
import { apiPost } from "./lib/api";

interface Row {
  bucket: string;
  label: string | null;
  value: number;
  /** Present when the query was sampled (S12): ±absolute at 95% confidence, and whether the series was thick enough. */
  ci95?: number;
  reliable?: boolean;
}

/** The /insights/trend response is a plain row array, or a sampled envelope when `sample: true` was sent. */
type TrendResponse = Row[] | { sampled: boolean; sampleRate?: number; rows: Row[] };

const RED = "#f2545b";
const PALETTE = ["#f2545b", "#f2a154", "#54b8f2", "#8f54f2", "#54f2a1", "#f254c8", "#b0b8c4"];

const field: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #232a32",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "6px 8px",
  fontSize: 13,
};

export function Insights(): JSX.Element {
  const [event, setEvent] = useState("$pageview");
  const [metric, setMetric] = useState<"total" | "unique">("total");
  const [interval, setInterval] = useState<"day" | "week" | "month">("day");
  const [breakdown, setBreakdown] = useState("");
  const [fast, setFast] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [sampled, setSampled] = useState<{ rate: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = (): void => {
    setErr(null);
    const spec: Record<string, unknown> = { event: event || undefined, metric, interval, days: 30 };
    if (breakdown) spec.breakdown = breakdown;
    apiPost<TrendResponse>("/insights/trend", { spec, sample: fast })
      .then((res) => {
        if (Array.isArray(res)) {
          setRows(res);
          setSampled(null);
        } else {
          setRows(res.rows);
          // The server un-samples a too-thin result and returns sampled:false — reflect that honestly.
          setSampled(res.sampled ? { rate: res.sampleRate ?? 0.1 } : null);
        }
      })
      .catch((e: unknown) => setErr(String(e)));
  };

  const buckets = [...new Set(rows.map((r) => r.bucket))].sort();
  const labels = [...new Set(rows.map((r) => r.label ?? "All events"))];
  const max = Math.max(1, ...rows.map((r) => r.value));
  const cellFor = (b: string, l: string): number =>
    rows.find((r) => r.bucket === b && (r.label ?? "All events") === l)?.value ?? 0;

  return (
    <section>
      <h2 style={{ color: RED }}>Insight builder</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input style={field} value={event} onChange={(e) => setEvent(e.target.value)} placeholder="event (blank = all)" />
        <select style={field} value={metric} onChange={(e) => setMetric(e.target.value as "total" | "unique")}>
          <option value="total">Total count</option>
          <option value="unique">Unique persons</option>
        </select>
        <select style={field} value={interval} onChange={(e) => setInterval(e.target.value as "day" | "week" | "month")}>
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>
        <input style={field} value={breakdown} onChange={(e) => setBreakdown(e.target.value)} placeholder="break down by prop (e.g. $browser)" />
        <label style={{ color: "#c9d1d9", fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} />
          Fast (10% sample)
        </label>
        <button onClick={run} style={{ ...field, background: RED, borderColor: RED, cursor: "pointer" }}>
          Run
        </button>
      </div>

      {err && <p style={{ color: "salmon" }}>Query failed ({err}). Is the API running on :3001?</p>}
      {rows.length === 0 && !err && <p style={{ color: "#8b93a1" }}>Run a query to see the trend.</p>}

      {sampled && rows.length > 0 && (
        <p style={{ color: "#f2a154", fontSize: 12, margin: "0 0 8px" }}>
          Estimated from a {Math.round(sampled.rate * 100)}% sample — largest bucket is{" "}
          {(() => {
            const top = rows.reduce((a, b) => (b.value > a.value ? b : a), rows[0]);
            const rel = top.ci95 && top.value ? Math.round((top.ci95 / top.value) * 100) : 0;
            return `~${top.value.toLocaleString()} ±${rel}%`;
          })()}
          . Uncheck “Fast” for exact counts.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <svg width={680} height={240} style={{ border: "1px solid #232a32", borderRadius: 10, background: "#0d1117" }}>
            {buckets.map((b, bi) => {
              const groupW = 660 / buckets.length;
              const barW = Math.max(2, groupW / (labels.length + 1));
              return labels.map((l, li) => {
                const v = cellFor(b, l);
                const h = (v / max) * 190;
                const x = 10 + bi * groupW + li * barW;
                return <rect key={`${b}-${l}`} x={x} y={220 - h} width={barW - 1} height={h} fill={PALETTE[li % PALETTE.length]} />;
              });
            })}
          </svg>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
            {labels.map((l, li) => (
              <span key={l} style={{ color: "#c9d1d9" }}>
                <span style={{ display: "inline-block", width: 10, height: 10, background: PALETTE[li % PALETTE.length], marginRight: 4 }} />
                {l}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
