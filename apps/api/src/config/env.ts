import { z } from "zod";
import { findEnvFile } from "./load-env.js";

import dotenv from "dotenv";

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
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  DESKTOP_BASE_URL: z.string().url().default("http://localhost:3001"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
});

export const env = envSchema.parse(process.env);