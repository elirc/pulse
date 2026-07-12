import { describe, it, expect } from "vitest";
import { sendReport, InMemoryEmailTransport, type DashboardSnapshot } from "./report";

/**
 * E2E (S10): a scheduled report is assembled from tile results and delivered. In production the transport is
 * SMTP → mailpit; here it's the in-memory transport (the same seam). Proves the whole render→send path and that
 * the delivered email carries the snapshot with its point-in-time footer.
 */
describe("scheduled report E2E (S10)", () => {
  it("assembles tile results and the report lands with the snapshot footer", async () => {
    const snapshot: DashboardSnapshot = {
      name: "Exec Weekly",
      generatedAt: "2026-08-10T09:00:00Z",
      tiles: [
        { insightId: "signups", computedAt: "2026-08-10T08:55:00Z", value: [{ bucket: "2026-08-09", value: 412 }] },
        { insightId: "activation", computedAt: "2026-08-10T08:56:00Z", value: { steps: [{ count: 412 }, { count: 190 }] } },
      ],
    };
    const mailpit = new InMemoryEmailTransport();
    await sendReport(snapshot, "exec@acme.com", mailpit);

    expect(mailpit.sent).toHaveLength(1);
    const email = mailpit.sent[0];
    expect(email.to).toBe("exec@acme.com");
    expect(email.html).toContain("signups");
    expect(email.html).toContain("412");
    expect(email.html).toContain("point-in-time snapshot, not a live link");
  });
});
