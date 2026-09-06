import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

function findEnvFile(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envFile = findEnvFile(process.cwd());
if (envFile) {
  dotenv.config({ path: envFile });
}

export interface AppConfig {
  apiUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = env.DESKTOP_API_URL?.trim();
  return {
    apiUrl: raw && raw.length > 0 ? raw : "http://localhost:4000",
  };
}
