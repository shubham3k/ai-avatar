import { copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await copyFile(
  resolve(appRoot, "src/main/preload.cjs"),
  resolve(appRoot, "dist/main/preload.cjs"),
);