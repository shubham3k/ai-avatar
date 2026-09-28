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

const DEFAULT_SYNC_INTERVAL_MINUTES = 5;
const MIN_SYNC_INTERVAL_MINUTES = 5;
const MAX_SYNC_INTERVAL_MINUTES = 30;

export interface AppConfig {
  /**
   * Phase 4.2: normally null, meaning "start the API in-process on a
   * dynamically chosen port" (see index.ts). Set DESKTOP_API_URL only to
   * point the desktop app at an already-running external API instance —
   * an escape hatch for advanced dev workflows, not the default path.
   */
  apiUrl: string | null;
  /**
   * How often the background sync scheduler (sync-scheduler.ts) runs the
   * checkNow sequence, in minutes. Defaults to 5 (was 15 until Sept 25,
   * 2026 — the user's retest showed a new email waiting up to 15 minutes
   * for the next sync), clamped to [5, 30] as a sanity bound; an
   * out-of-range or unparseable DESKTOP_SYNC_INTERVAL_MINUTES falls back to
   * the 5-minute default rather than silently disabling the scheduler or hammering the
   * API.
   */
  syncIntervalMinutes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = env.DESKTOP_API_URL?.trim();
  const rawInterval = Number(env.DESKTOP_SYNC_INTERVAL_MINUTES?.trim());
  const syncIntervalMinutes =
    Number.isFinite(rawInterval) &&
    rawInterval >= MIN_SYNC_INTERVAL_MINUTES &&
    rawInterval <= MAX_SYNC_INTERVAL_MINUTES
      ? rawInterval
      : DEFAULT_SYNC_INTERVAL_MINUTES;
  return {
    apiUrl: raw && raw.length > 0 ? raw : null,
    syncIntervalMinutes,
  };
}
