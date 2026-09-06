import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "dotenv";

let dir = process.cwd();
for (let depth = 0; depth < 6; depth += 1) {
  const candidate = join(dir, ".env");
  if (existsSync(candidate)) {
    config({ path: candidate });
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

process.env.NODE_ENV = "test";
