import { describe, it, expect } from "vitest";
import { renderReport, sendReport, InMemoryEmailTransport, type DashboardSnapshot } from "./report";

const snapshot: DashboardSnapshot = {
  name: "Weekly Growth",
  generatedAt: "2026-08-10T09:00:00Z",
  tiles: [
    { insightId: "i1", computedAt: "2026-08-10T08:55:00Z", value: [{ bucket: "2026-08-09", value: 120 }] },
    { insightId: "i2", computedAt: "2026-08-10T08:56:00Z", value: { steps: [{ count: 100 }, { count: 30 }] } },
  ],
};

describe("scheduled report render (S10)", () => {
  it("renders the dashboard with a snapshot-not-live footer", () => {
    const { subject, html } = renderReport(snapshot);
    expect(subject).toContain("Weekly Growth");
    expect(html).toContain("i1");
    expect(html).toContain("120");
    expect(html).toContain("point-in-time snapshot, not a live link"); // the semantics stated in the footer
  });

  it("sends the rendered snapshot through the transport", async () => {
    const transport = new InMemoryEmailTransport();
    await sendReport(snapshot, "analyst@acme.com", transport);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].to).toBe("analyst@acme.com");
    expect(transport.sent[0].subject).toContain("Weekly Growth");
  });
});
