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
  // SQLite (Phase 4.1) — a `file:` path, resolved relative to
  // prisma/schema.prisma's directory, not the process cwd.
  DATABASE_URL: z.string().url().default("file:./dev.db"),
  // Required for encrypting Google OAuth refresh/access tokens at rest.
  // Base64-encoded 32-byte key, e.g. `openssl rand -base64 32`.
  ENCRYPTION_KEY: z.string().min(32).optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
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