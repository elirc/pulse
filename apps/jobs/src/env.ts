import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DB: z.string().default("pulse"),
  RECOMPUTE_EVERY_MS: z.coerce.number().default(60 * 60 * 1000), // hourly default
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
