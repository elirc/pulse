import { defineConfig } from "tsup";

// The SDK ships to strangers' pages, so it builds two ways: an ESM module (for bundlers) and a minified IIFE
// global (`window.pulse`) for the copy-paste <script> snippet. Zero externals — everything is inlined, which is
// exactly what the bundle budget (scripts/check-size.mjs) polices.
export default defineConfig({
  entry: { pulse: "src/index.ts" },
  format: ["esm", "iife"],
  globalName: "pulse",
  minify: true,
  treeshake: true,
  clean: true,
  dts: false,
  outDir: "dist",
});
