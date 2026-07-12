/**
 * The funnel query language (S08). A funnel is an ordered sequence of steps with a conversion window: how many
 * people reached each step, and where they dropped off. Like the trend AST, it's a closed, versioned definition
 * (stored on the Insight), so it survives engine swaps and compiles to whichever backend.
 *
 * The one semantics decision baked in here (and documented in the user-facing semantics doc): the conversion
 * window anchors at STEP-1 entry, and steps are ordered-with-gaps (other events may occur between). Those are
 * product decisions with revenue implications, not SQL trivia — see the debate + semantics doc.
 */
import { z } from "zod";
import { FilterSchema } from "./spec";

export const FunnelStepSchema = z.object({
  event: z.string().min(1).max(200),
  filters: z.array(FilterSchema).max(10).default([]),
});
export type FunnelStep = z.infer<typeof FunnelStepSchema>;

export const FunnelSpecSchema = z.object({
  steps: z.array(FunnelStepSchema).min(2).max(10),
  /** Conversion window, in days, measured from step-1 entry. */
  windowDays: z.number().int().min(1).max(90).default(7),
  /** Lookback window for step-1 entries, in days. */
  days: z.number().int().min(1).max(365).default(30),
  /** Break the funnel down by a person/event property. */
  breakdown: z.string().min(1).max(200).optional(),
});
export type FunnelSpec = z.infer<typeof FunnelSpecSchema>;

/** Per-step result: how many reached this step, and the drop-off from the previous. */
export interface FunnelStepResult {
  step: number;
  event: string;
  count: number;
  /** Fraction of step-1 that reached here (0..1). */
  conversionFromStart: number;
  /** Fraction of the PREVIOUS step that reached here (0..1); 1 for step 1. */
  conversionFromPrev: number;
}

export interface FunnelResult {
  steps: FunnelStepResult[];
  /** Median ms from step-1 to the final step, over people who converted fully. */
  medianTimeToConvertMs: number | null;
  /** p90 of the same distribution — medians lie less than means for skewed durations; p90 shows the tail. */
  p90TimeToConvertMs: number | null;
}

/** One breakdown row: a property value and its funnel. */
export interface FunnelBreakdownResult {
  label: string;
  result: FunnelResult;
}
