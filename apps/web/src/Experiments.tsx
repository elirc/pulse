/**
 * Experiment results (S14). The whole design commitment is in the WORDING: we never show a bare p-value. An
 * experiment is in exactly one of three states — "collecting" (with progress toward the required sample size),
 * "significant" (with the lift and its CI), or "no effect detected" (NOT "no effect" — absence of significance is
 * not proof of equivalence). This is S12's honesty contract, extended from sampled numbers to inferred ones.
 */
import { useEffect, useState } from "react";
import { apiGet } from "./lib/api";

const RED = "#f2545b";

interface VariantResult {
  variant: string;
  exposed: number;
  converted: number;
  rate: number;
}
interface ExperimentResult {
  variants: VariantResult[];
  control: string;
  test: string;
  lift: number;
  liftCiLow: number;
  liftCiHigh: number;
  pValue: number;
  significant: boolean;
}
interface ExperimentRow {
  id: string;
  name: string;
  status: string;
  goalEvent: string;
}

// The required sample size the analyst set when designing the test (would come from the experiment record; a
// sensible default here so the "collecting" progress bar has a target).
const REQUIRED_N_PER_VARIANT = 2000;

type State = "collecting" | "significant" | "no_effect_detected";

function stateOf(r: ExperimentResult): State {
  const minExposed = Math.min(...r.variants.map((v) => v.exposed));
  if (minExposed < REQUIRED_N_PER_VARIANT) return "collecting";
  return r.significant ? "significant" : "no_effect_detected";
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const signedPct = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export function Experiments(): JSX.Element {
  const [experiments, setExperiments] = useState<ExperimentRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<ExperimentResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ExperimentRow[]>("/experiments").then(setExperiments).catch((e: unknown) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setResult(null);
    apiGet<ExperimentResult>(`/experiments/${selected}/results`).then(setResult).catch((e: unknown) => setErr(String(e)));
  }, [selected]);

  return (
    <section>
      <h2 style={{ color: RED }}>Experiments</h2>
      {err && <p style={{ color: "salmon" }}>Couldn’t load ({err}). Is the API running on :3001?</p>}
      {experiments.length === 0 && !err && <p style={{ color: "#8b93a1" }}>No experiments yet.</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {experiments.map((e) => (
          <button
            key={e.id}
            onClick={() => setSelected(e.id)}
            style={{
              background: selected === e.id ? RED : "#0d1117",
              border: `1px solid ${selected === e.id ? RED : "#232a32"}`,
              borderRadius: 6,
              color: "#e6edf3",
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {e.name} <span style={{ color: "#8b93a1" }}>({e.status})</span>
          </button>
        ))}
      </div>

      {result && <ResultCard result={result} />}
    </section>
  );
}

function ResultCard({ result }: { result: ExperimentResult }): JSX.Element {
  const state = stateOf(result);
  return (
    <div style={{ border: "1px solid #232a32", borderRadius: 10, padding: 16, background: "#0d1117" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
        <thead>
          <tr style={{ color: "#8b93a1", textAlign: "left" }}>
            <th style={{ padding: 4 }}>Variant</th>
            <th style={{ padding: 4 }}>Exposed</th>
            <th style={{ padding: 4 }}>Converted</th>
            <th style={{ padding: 4 }}>Rate</th>
          </tr>
        </thead>
        <tbody>
          {result.variants.map((v) => (
            <tr key={v.variant} style={{ color: "#c9d1d9" }}>
              <td style={{ padding: 4 }}>{v.variant === result.control ? `${v.variant} (control)` : v.variant}</td>
              <td style={{ padding: 4 }}>{v.exposed.toLocaleString()}</td>
              <td style={{ padding: 4 }}>{v.converted.toLocaleString()}</td>
              <td style={{ padding: 4 }}>{pct(v.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {state === "collecting" && <Collecting result={result} />}
      {state === "significant" && <Significant result={result} />}
      {state === "no_effect_detected" && <NoEffect />}
    </div>
  );
}

function Collecting({ result }: { result: ExperimentResult }): JSX.Element {
  const minExposed = Math.min(...result.variants.map((v) => v.exposed));
  const progress = Math.min(1, minExposed / REQUIRED_N_PER_VARIANT);
  return (
    <div>
      <p style={{ color: "#f2a154", margin: "0 0 6px", fontWeight: 600 }}>Still collecting</p>
      <p style={{ color: "#8b93a1", fontSize: 12, margin: "0 0 6px" }}>
        {minExposed.toLocaleString()} / {REQUIRED_N_PER_VARIANT.toLocaleString()} exposures per variant. Results
        are hidden until the pre-registered sample size is reached — checking early and stopping on a good number
        is the peeking problem.
      </p>
      <div style={{ height: 8, background: "#232a32", borderRadius: 4 }}>
        <div style={{ width: `${progress * 100}%`, height: 8, background: "#f2a154", borderRadius: 4 }} />
      </div>
    </div>
  );
}

function Significant({ result }: { result: ExperimentResult }): JSX.Element {
  const up = result.lift >= 0;
  return (
    <div>
      <p style={{ color: up ? "#54f2a1" : RED, margin: "0 0 6px", fontWeight: 600 }}>
        {up ? "Significant improvement" : "Significant regression"}
      </p>
      <p style={{ color: "#c9d1d9", fontSize: 13, margin: 0 }}>
        Lift <strong>{signedPct(result.lift)}</strong> (95% CI {signedPct(result.liftCiLow)} to{" "}
        {signedPct(result.liftCiHigh)}).
      </p>
    </div>
  );
}

function NoEffect(): JSX.Element {
  return (
    <div>
      <p style={{ color: "#8b93a1", margin: "0 0 6px", fontWeight: 600 }}>No effect detected</p>
      <p style={{ color: "#8b93a1", fontSize: 12, margin: 0 }}>
        The test reached its sample size without a significant difference. This is <em>not</em> proof the variants
        are equivalent — only that no effect large enough to detect was found.
      </p>
    </div>
  );
}
