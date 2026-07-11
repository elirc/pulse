/**
 * SDK docs page (S03). The install snippet and a minimal API reference for @pulse/sdk. Everything here is
 * public-key territory (the write key is safe in page source); the SDK is <6KB gz, zero-dependency, and never
 * throws into the host page.
 */

const INSTALL = `<script src="https://cdn.pulse.example/pulse.global.js"></script>
<script>
  pulse.init({ writeKey: "pw_live_…" });   // public write key
  pulse.capture("signup_started");          // your first custom event
</script>`;

const NPM = `import { init, capture, identify, reset } from "@pulse/sdk";

init({ writeKey: "pw_live_…" });
capture("purchase", { plan: "pro", amount: 49 });
identify("user_123");   // bind the anonymous visitor to a known id
reset();                // logout: forget identity, start a fresh anonymous id`;

const API: Array<{ sig: string; note: string }> = [
  { sig: "init(options)", note: "writeKey (required), apiHost, flushAt, flushIntervalMs, autocapturePageviews, maxQueue, onError." },
  { sig: "capture(name, props?)", note: "Queue a custom event. Batched; flushed on size / time / tab-hide; beacon on unload." },
  { sig: "identify(distinctId)", note: "Attach a known user id to subsequent events. Pre-identify stitching is an S06 concern." },
  { sig: "reset()", note: "Clear the stored identity (logout) and mint a fresh anonymous id." },
];

const Block = ({ code }: { code: string }): JSX.Element => (
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
    <code>{code}</code>
  </pre>
);

export function Docs(): JSX.Element {
  return (
    <section>
      <h2 style={{ color: "#f2545b" }}>SDK — install</h2>
      <p style={{ color: "#8b93a1" }}>Script tag (the copy-paste path):</p>
      <Block code={INSTALL} />
      <p style={{ color: "#8b93a1" }}>Or as a module:</p>
      <Block code={NPM} />
      <h2 style={{ color: "#f2545b" }}>API</h2>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
        <tbody>
          {API.map((row) => (
            <tr key={row.sig} style={{ borderTop: "1px solid #232a32" }}>
              <td style={{ padding: "8px 12px 8px 0", whiteSpace: "nowrap", color: "#f2545b", fontFamily: "monospace" }}>
                {row.sig}
              </td>
              <td style={{ padding: "8px 0", color: "#c9d1d9" }}>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "#5b6572", fontSize: 12, marginTop: 16 }}>
        &lt;6KB gzipped · zero dependencies · never throws into your page · sendBeacon on unload.
      </p>
    </section>
  );
}
