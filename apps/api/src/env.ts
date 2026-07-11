import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(3001),
  WEB_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().url().optional(),
  // Session signing secret. A default keeps dev/CI booting; production must override (see ADR-0003).
  SESSION_SECRET: z.string().min(1).default("dev-insecure-session-secret-change-me"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  STREAM_KEY: z.string().default("pulse:events"),
  DLQ_KEY: z.string().default("pulse:events:dlq"),
  CONSUMER_GROUP: z.string().default("inserters"),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
