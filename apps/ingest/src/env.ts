import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  INGEST_PORT: z.coerce.number().default(3002),
  WEB_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().url().optional(), // optional so the server boots (health) without a DB in dev/CI
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
