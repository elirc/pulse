/**
 * Project setup page (S02). The onboarding surface: copy the install snippet with your project's WRITE key,
 * paste it into your site, fire an event, watch it land in daily counts. The write key shown here is a public
 * credential by design — it ships in your page source to every visitor. That is exactly why it can only append
 * (the capability split in this sprint), and why the secret key that can READ your data is never shown to a
 * browser.
 */

const SNIPPET = (writeKey: string): string =>
  `<script src="https://cdn.pulse.example/sdk.js"></script>
<script>
  pulse.init("${writeKey}");        // your PUBLIC write key — safe in page source
  pulse.capture("$pageview");        // your first event
</script>`;

const CHECKLIST: Array<{ done: boolean; label: string }> = [
  { done: true, label: "Create a project (an org owns projects; a project owns keys and events)" },
  { done: true, label: "Issue a write key — shown once, stored only as a hash" },
  { done: false, label: "Paste the snippet into your site" },
  { done: false, label: "Fire an event and watch it appear in Events per day" },
];

export function Setup({ writeKey = "pw_live_…" }: { writeKey?: string }): JSX.Element {
  return (
    <section>
      <h2 style={{ color: "#f2545b" }}>Set up your project</h2>
      <p style={{ color: "#8b93a1" }}>
        Drop this into your site’s <code>&lt;head&gt;</code>. The write key is public on purpose — it can only
        append events, never read them.
      </p>
      <pre
        style={{
          background: "#0d1117",
          border: "1px solid #232a32",
          borderRadius: 10,
          padding: 16,
          overflowX: "auto",
          color: "#e6edf3",
          fontSize: 13,
        }}
      >
        <code>{SNIPPET(writeKey)}</code>
      </pre>
      <ol style={{ color: "#c9d1d9", lineHeight: 1.9, paddingLeft: 20 }}>
        {CHECKLIST.map((step) => (
          <li key={step.label} style={{ opacity: step.done ? 0.55 : 1 }}>
            {step.done ? "✓ " : "○ "}
            {step.label}
          </li>
        ))}
      </ol>
      <p style={{ color: "#5b6572", fontSize: 12 }}>
        Need to read your events from a server? Issue a <strong>secret</strong> key (<code>ps_live_…</code>) —
        it never touches a browser and is the only key type allowed to read.
      </p>
    </section>
  );
}
