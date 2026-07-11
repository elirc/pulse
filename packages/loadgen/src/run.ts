/**
 * The load runner (S01, thin I/O edge — not unit-tested). Fires generated events at `POST /e` at a target
 * rate and prints throughput/latency. This is what produces the numbers every pipeline PR reports, and what
 * S07 uses to push Postgres across the exit criteria written in ADR-0002.
 *
 *   pnpm --filter @pulse/loadgen start -- --rate 500 --seconds 30 --url http://localhost:3002/e
 */
import { generateBatch } from "./generate";

interface Opts {
  rate: number;
  seconds: number;
  url: string;
  users: number;
}

function parseArgs(argv: string[]): Opts {
  const get = (flag: string, def: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  return {
    rate: Number(get("--rate", "200")),
    seconds: Number(get("--seconds", "10")),
    url: get("--url", "http://localhost:3002/e"),
    users: Number(get("--users", "1000")),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const total = opts.rate * opts.seconds;
  const events = generateBatch(total, { users: opts.users, seed: 1 });
  const latencies: number[] = [];
  let ok = 0;
  let failed = 0;

  const started = Date.now();
  const perTick = Math.max(1, Math.floor(opts.rate / 10)); // 10 ticks/sec
  for (let i = 0; i < events.length; i += perTick) {
    const slice = events.slice(i, i + perTick);
    await Promise.all(
      slice.map(async (e) => {
        const t0 = Date.now();
        try {
          const res = await fetch(opts.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(e) });
          latencies.push(Date.now() - t0);
          if (res.ok) ok++;
          else failed++;
        } catch {
          failed++;
        }
      }),
    );
    await new Promise((r) => setTimeout(r, 100));
  }

  const elapsed = (Date.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const p = (q: number): number => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ?? 0;
  console.log(`sent=${ok + failed} ok=${ok} failed=${failed} throughput=${(ok / elapsed).toFixed(0)}/s p50=${p(0.5)}ms p95=${p(0.95)}ms p99=${p(0.99)}ms`);
}

void main();
