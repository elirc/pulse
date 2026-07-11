import { defineConfig } from "vitest/config";

// The SDK is browser code: it touches window, document, localStorage, navigator. jsdom gives the unit tests a
// DOM to run against. (Real cross-browser behavior — sendBeacon on a genuine unload — is a lab/manual check.)
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
