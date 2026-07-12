import { describe, it, expect } from "vitest";
import { assessPipeline, DEFAULT_PIPELINE_THRESHOLDS, type PipelineSample } from "./pipeline-health";

const ok: PipelineSample = { ingestRatePerSec: 5000, consumerLag: 100, dlqDepth: 0, insertBatchP95Ms: 120 };

describe("assessPipeline (S15)", () => {
  it("all-within-thresholds is healthy", () => {
    const h = assessPipeline(ok);
    expect(h.status).toBe("healthy");
  });

  it("lag past the warn line degrades, past the crit line goes critical", () => {
    expect(assessPipeline({ ...ok, consumerLag: DEFAULT_PIPELINE_THRESHOLDS.lagWarn }).status).toBe("degraded");
    expect(assessPipeline({ ...ok, consumerLag: DEFAULT_PIPELINE_THRESHOLDS.lagCrit }).status).toBe("critical");
  });

  it("any DLQ entry degrades — a dead-lettered event is a defect to look at", () => {
    expect(assessPipeline({ ...ok, dlqDepth: 1 }).status).toBe("degraded");
  });

  it("the WORST signal sets the overall status, and every breach is named", () => {
    const h = assessPipeline({ ...ok, consumerLag: DEFAULT_PIPELINE_THRESHOLDS.lagWarn, dlqDepth: 5000 });
    expect(h.status).toBe("critical"); // DLQ crit dominates the lag warn
    expect(h.reasons.length).toBe(2);
    expect(h.reasons.some((r) => r.includes("DLQ"))).toBe(true);
  });

  it("slow inserts alone can degrade the pipeline", () => {
    expect(assessPipeline({ ...ok, insertBatchP95Ms: 600 }).status).toBe("degraded");
    expect(assessPipeline({ ...ok, insertBatchP95Ms: 3000 }).status).toBe("critical");
  });
});
