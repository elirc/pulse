/**
 * Demo-data runner (S05) — the thin I/O edge that fires the generated demo dataset at the ingest endpoint, in
 * batches, so the whole product (trends, live feed, and later funnels/retention) has realistic signal. Not
 * tested; the generation core (demo.ts) is. Run:
 *   WRITE_KEY=pw_live_… INGEST_URL=http://localhost:3002 USERS=1000 DAYS=30 tsx src/run-demo.ts
 */
import { generateDemoData } from "./demo";
import type { EventInput } from "@pulse/shared";

const INGEST_URL = process.env.INGEST_URL ?? "http://localhost:3002";
const WRITE_KEY = process.env.WRITE_KEY ?? "pw_live_replace_me";
const USERS = Number(process.env.USERS ?? 1000);
const DAYS = Number(process.env.DAYS ?? 30);
const BATCH = 100;

async function main(): Promise<void> {
  const events = generateDemoData({ users: USERS, days: DAYS, seed: 42 });
  console.log(`generated ${events.length} demo events across ${DAYS} days for ${USERS} people`);
  let sent = 0;
  for (let i = 0; i < events.length; i += BATCH) {
    const batch: EventInput[] = events.slice(i, i + BATCH);
    const res = await fetch(`${INGEST_URL}/e`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${WRITE_KEY}` },
      body: JSON.stringify(batch),
    });
    if (res.ok) sent += batch.length;
    else console.error(`batch at ${i} → ${res.status}`);
  }
  console.log(`sent ${sent}/${events.length} (202 = accepted; the consumer stores them)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
