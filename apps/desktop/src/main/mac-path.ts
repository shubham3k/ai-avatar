import { existsSync, readdirSync } from "node:fs";
import { posix } from "node:path";

// Mac paths, built the same way when tests run on Windows.
const { join } = posix;

/**
 * ADR-007: a Mac app started from Finder/Dock gets launchd's minimal PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin) — not the user's shell PATH — so `npx`
 * (MCP connections) isn't found. Adds the usual Node locations that exist:
 * Homebrew (Apple Silicon, then Intel), Volta, and the newest nvm Node.
 * Pure apart from the injected file checks, so it's testable anywhere.
 */
export function macToolPath(
  currentPath: string | undefined,
  home: string,
  fs: { exists(path: string): boolean; list(path: string): string[] } = {
    exists: existsSync,
    list: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
  },
): string {
  const parts = (currentPath ?? "").split(":").filter(Boolean);
  const nvmRoot = join(home, ".nvm", "versions", "node");
  const newestNvm = fs
    .list(nvmRoot)
    .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
    .sort((a, b) => compareVersions(b, a))[0];
  const candidates = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".volta", "bin"),
    ...(newestNvm ? [join(nvmRoot, newestNvm, "bin")] : []),
  ];
  const additions = candidates.filter((dir) => !parts.includes(dir) && fs.exists(dir));
  return [...parts, ...additions].join(":");
}

function compareVersions(a: string, b: string): number {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
