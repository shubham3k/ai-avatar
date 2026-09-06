import dotenv from "dotenv";
import { z } from "zod";
import { findEnvFile } from "./load-env.js";

const envFile = findEnvFile(process.cwd());
if (envFile) {
  dotenv.config({ path: envFile });
} else {
  dotenv.config();
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://postgres:postgres@localhost:5433/ai_exec_agent"),
  // Required once OAuth token encryption is implemented (Phase 1.3).
  ENCRYPTION_KEY: z.string().min(32).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  CRON_SCHEDULE: z.string().default("*/5 * * * *"),
});

export const env = envSchema.parse(process.env);
