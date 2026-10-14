import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

/** Keep the log small: past this size it's moved to main.old.log and started again. */
const MAX_BYTES = 2_000_000;

/**
 * ADR-007 rev 1: the packaged app has no console, so problems on a user's
 * Mac (or PC) were invisible. Copies the main process's console messages
 * and crashes to <app data>/logs/main.log. Only what the main process
 * already prints goes there (startup, sync, hotkey, focus messages) — the
 * embedded API's own logger writes elsewhere, and nothing here prints email
 * text or tokens.
 */
export function startFileLog(logDir: string, target: Pick<Console, "log" | "warn" | "error"> = console): string {
  mkdirSync(logDir, { recursive: true });
  const file = join(logDir, "main.log");

  function write(level: string, args: unknown[]): void {
    try {
      if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, join(logDir, "main.old.log"));
      appendFileSync(file, `${new Date().toISOString()} ${level} ${format(...args)}\n`);
    } catch {
      // Logging must never break the app.
    }
  }

  for (const level of ["log", "warn", "error"] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      write(level, args);
      original(...args);
    };
  }
  write("log", [`--- app started (${process.platform} ${process.arch}) ---`]);
  return file;
}
