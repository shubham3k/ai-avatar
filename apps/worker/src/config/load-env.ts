import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findEnvFile(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
