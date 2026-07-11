// Bundle budget gate (S03): the SDK's gzipped script-tag build must stay under 6KB. This is a CI CONTRACT —
// every dependency and every clever abstraction is a negotiation against this number. Zero deps by budget.
// No external tooling: Node's own zlib gzips the built file and we compare bytes.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 6 * 1024; // 6144
const BUNDLE = "dist/pulse.global.js"; // the minified IIFE a <script> tag pulls down

let bytes;
try {
  bytes = readFileSync(BUNDLE);
} catch {
  console.error(`check-size: ${BUNDLE} not found — run the build first (turbo runs build before budget).`);
  process.exit(1);
}

const gz = gzipSync(bytes, { level: 9 }).length;
const pct = ((gz / BUDGET_BYTES) * 100).toFixed(0);
console.log(`@pulse/sdk bundle: ${gz} B gzipped / ${BUDGET_BYTES} B budget (${pct}%)`);

if (gz > BUDGET_BYTES) {
  console.error(`❌ Bundle budget exceeded by ${gz - BUDGET_BYTES} B. Trim it or justify a budget bump in review.`);
  process.exit(1);
}
console.log("✅ Within budget.");
