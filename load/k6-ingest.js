/**
 * k6 load test for the ingest hot path (S04). Runs against a locally-running ingest server (+ Redis for the
 * pipeline, or the S03 synchronous build for the baseline). Not run in CI — this produces the numbers reported
 * in the PR body, on a lab box where Redis and Postgres are real.
 *
 *   BASELINE (S03 synchronous insert):  git checkout the pre-S04 ingest, point at Postgres, run this.
 *   PIPELINE (S04 enqueue → 202):        run the current ingest with Redis, run this.
 *
 * Usage:
 *   WRITE_KEY=pw_live_… INGEST_URL=http://localhost:3002 k6 run load/k6-ingest.js
 *
 * The scenario holds a constant arrival rate (open model) so a slow server shows up as rising latency and
 * dropped iterations, not as a self-throttling closed loop.
 */
import http from "k6/http";
import { check } from "k6";

const INGEST_URL = __ENV.INGEST_URL || "http://localhost:3002";
const WRITE_KEY = __ENV.WRITE_KEY || "pw_live_replace_me";
const RATE = Number(__ENV.RATE || 2000); // events/sec target

export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 200,
      maxVUs: 1000,
    },
  },
  thresholds: {
    // The pipeline target: p95 well under the synchronous baseline. Baseline runs typically blow this.
    http_req_duration: ["p(95)<15"],
    checks: ["rate>0.99"],
  },
};

const NAMES = ["$pageview", "signup_started", "purchase", "feature_used"];

export default function () {
  const body = JSON.stringify({
    name: NAMES[Math.floor(Math.random() * NAMES.length)],
    distinctId: `u_${Math.floor(Math.random() * 100000)}`,
    props: { $user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120", $ip: "8.8.8.8" },
    uuid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  const res = http.post(`${INGEST_URL}/e`, body, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WRITE_KEY}` },
  });
  // Pipeline returns 202 (accepted); the synchronous baseline returned 200 (processed).
  check(res, { "accepted (202/200)": (r) => r.status === 202 || r.status === 200 });
}
