import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  INGEST_PORT: z.coerce.number().default(3002),
  WEB_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().url().optional(), // optional so the server boots (health) without a DB in dev/CI
  REDIS_URL: z.string().default("redis://localhost:6379"),
  STREAM_KEY: z.string().default("pulse:events"),
  INGEST_MAX_DEPTH: z.coerce.number().default(100_000), // backpressure watermark (stream backlog)
  // S13 per-key rate limit (token bucket): burst capacity + sustained events/sec per write key's project.
  RATE_LIMIT_BURST: z.coerce.number().default(500),
  RATE_LIMIT_PER_SEC: z.coerce.number().default(200),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
