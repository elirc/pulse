/**
 * Retention triangle (S09). Rows = cohorts (by first-seen week), columns = periods since; each cell is how many
 * of that cohort returned. The classic misread — tiny cohorts flashing 100% — is why the cohort SIZE column is
 * always shown and a %/absolute toggle is offered: a percentage without its denominator lies.
 */
import { useEffect, useState } from "react";
import { apiPost } from "./lib/api";

interface CohortRow {
  bucket: string;
  size: number;
  retained: number[];
}
interface RetentionResult {
  cohorts: CohortRow[];
}

const RED = "#f2545b";

function cellColor(pct: number): string {
  // pct 0..1 → transparent → red
  const a = Math.max(0, Math.min(1, pct));
  return `rgba(242, 84, 91, ${a.toFixed(2)})`;
}

export function Retention(): JSX.Element {
  const [data, setData] = useState<RetentionResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [asPct, setAsPct] = useState(true);

  useEffect(() => {
    apiPost<RetentionResult>("/insights/retention", { spec: { granularity: "week", periods: 8, days: 56 } })
      .then(setData)
      .catch((e: unknown) => setErr(String(e)));
  }, []);

  const periods = data?.cohorts[0]?.retained.length ?? 0;

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ color: RED }}>Retention</h2>
        <label style={{ color: "#8b93a1", fontSize: 13 }}>
          <input type="checkbox" checked={asPct} onChange={(e) => setAsPct(e.target.checked)} /> show %
        </label>
      </div>
      {err && <p style={{ color: "#8b93a1" }}>Retention needs the ClickHouse event source ({err}).</p>}
      {data && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "#8b93a1" }}>
                <th style={{ padding: "4px 8px", textAlign: "left" }}>Cohort</th>
                <th style={{ padding: "4px 8px" }}>Size</th>
                {Array.from({ length: periods }, (_, p) => (
                  <th key={p} style={{ padding: "4px 8px" }}>
                    +{p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((c) => (
                <tr key={c.bucket}>
                  <td style={{ padding: "4px 8px", color: "#c9d1d9" }}>{c.bucket}</td>
                  <td style={{ padding: "4px 8px", color: "#c9d1d9", fontWeight: 600 }}>{c.size}</td>
                  {c.retained.map((n, p) => {
                    const pct = c.size === 0 ? 0 : n / c.size;
                    return (
                      <td key={p} style={{ padding: "4px 8px", textAlign: "center", background: cellColor(pct), color: "#e6edf3" }}>
                        {asPct ? `${(pct * 100).toFixed(0)}%` : n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
