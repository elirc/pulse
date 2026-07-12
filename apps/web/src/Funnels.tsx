/**
 * Funnel builder (S08). Add ordered steps, run the funnel, see conversion + drop-off. Dataviz convention: show
 * the DROP, not just the survivors — a bar per step scaled to step-1, with the drop-off called out.
 */
import { useState } from "react";
import { apiPost } from "./lib/api";

interface StepResult {
  step: number;
  event: string;
  count: number;
  conversionFromStart: number;
  conversionFromPrev: number;
}
interface FunnelResult {
  steps: StepResult[];
  medianTimeToConvertMs: number | null;
}

const RED = "#f2545b";
const field: React.CSSProperties = { background: "#0d1117", border: "1px solid #232a32", borderRadius: 6, color: "#e6edf3", padding: "6px 8px", fontSize: 13 };

export function Funnels(): JSX.Element {
  const [steps, setSteps] = useState<string[]>(["$pageview", "signup_started", "purchase"]);
  const [result, setResult] = useState<FunnelResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = (): void => {
    setErr(null);
    const spec = { steps: steps.filter(Boolean).map((event) => ({ event })), windowDays: 7, days: 30 };
    apiPost<FunnelResult>("/insights/funnel", { spec })
      .then(setResult)
      .catch((e: unknown) => setErr(String(e)));
  };

  const setStep = (i: number, v: string): void => setSteps((s) => s.map((x, j) => (j === i ? v : x)));

  return (
    <section>
      <h2 style={{ color: RED }}>Funnel</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        {steps.map((s, i) => (
          <input key={i} style={field} value={s} onChange={(e) => setStep(i, e.target.value)} placeholder={`step ${i + 1}`} />
        ))}
        <button onClick={() => setSteps((s) => [...s, ""])} style={{ ...field, cursor: "pointer" }}>+ step</button>
        <button onClick={run} style={{ ...field, background: RED, borderColor: RED, cursor: "pointer" }}>Run</button>
      </div>

      {err && <p style={{ color: "#8b93a1" }}>Funnel failed ({err}). Needs the ClickHouse backend.</p>}
      {result && (
        <div>
          {result.steps.map((s, i) => (
            <div key={s.step} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#c9d1d9" }}>
                <span>
                  <strong style={{ color: RED }}>{s.event}</strong> — {s.count.toLocaleString()} ({(s.conversionFromStart * 100).toFixed(0)}%)
                </span>
                {i > 0 && <span style={{ color: "#8b93a1" }}>drop {(100 - s.conversionFromPrev * 100).toFixed(0)}%</span>}
              </div>
              <div style={{ background: "#161b22", borderRadius: 4, height: 22 }}>
                <div style={{ width: `${s.conversionFromStart * 100}%`, background: RED, height: 22, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
