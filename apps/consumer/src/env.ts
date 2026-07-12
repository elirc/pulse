import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  STREAM_KEY: z.string().default("pulse:events"),
  DLQ_KEY: z.string().default("pulse:events:dlq"),
  CONSUMER_GROUP: z.string().default("inserters"),
  CONSUMER_NAME: z.string().default("consumer-1"),
  BATCH_SIZE: z.coerce.number().default(200),
  // S07 migration flags.
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DB: z.string().default("pulse"),
  DUAL_WRITE: z.coerce.boolean().default(false), // write PG (truth) + CH (shadow)
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
