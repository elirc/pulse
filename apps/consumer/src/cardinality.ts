/**
 * Per-property cardinality tracking (S12). For each event property, maintain a HyperLogLog of its distinct
 * values, in-stream, for almost nothing (a few KB per property). This is what powers every downstream
 * cardinality guard: "how many distinct values does `$url` have?" answered cheaply, so the query layer can force
 * a top-N + Other on high-cardinality breakdowns instead of returning ten thousand series. You can't guard what
 * you don't count.
 */
import { HyperLogLog } from "@pulse/shared";
import type { QueuedEvent } from "@pulse/shared";

export class CardinalityTracker {
  private readonly byProperty = new Map<string, HyperLogLog>();

  track(event: QueuedEvent): void {
    for (const [key, value] of Object.entries(event.props)) {
      if (value === null || value === undefined) continue;
      let hll = this.byProperty.get(key);
      if (!hll) this.byProperty.set(key, (hll = new HyperLogLog()));
      hll.add(String(value));
    }
  }

  estimate(property: string): number {
    return this.byProperty.get(property)?.estimate() ?? 0;
  }

  /** All tracked properties with their approximate distinct counts — the data-management surface. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, hll] of this.byProperty) out[key] = hll.estimate();
    return out;
  }
}
