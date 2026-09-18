/**
 * Phase 4.6: builds a standalone, packaging-ready copy of `@ai-agent/api`
 * at `apps/desktop/resources/api` — the folder electron-builder's
 * `extraResources` ships alongside the packaged app, and that
 * `api-location.ts`'s `resolveApiRoot()` points at when `app.isPackaged`.
 *
 * Why not just point electron-builder at `apps/api` directly, or use
 * `pnpm deploy`: apps/api's own `node_modules` (like every pnpm workspace
 * package's) is a tree of symlinks/junctions into pnpm's content-addressable
 * store — copying that elsewhere (as packaging inherently does) leaves
 * dangling links, and `pnpm deploy`'s own internal virtual store uses
 * *absolute* Windows junctions, which break the same way once the deployed
 * folder is moved or the machine it was built on is gone. `@ai-agent/api`'s
 * actual runtime dependency surface is small, so this script sidesteps
 * pnpm's linking entirely for the packaged copy: it copies compiled
 * JS/schema output directly (no symlinks involved) and installs the
 * remaining node_modules dependencies with plain `npm install`, which
 * produces ordinary, fully real (non-symlinked) directories.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const apiSrcRoot = join(repoRoot, "apps", "api");
const sharedSrcRoot = join(repoRoot, "packages", "shared");
const targetRoot = join(desktopRoot, "resources", "api");

function log(message) {
  console.log(`[prepare-api-resources] ${message}`);
}

function run(command, args, cwd) {
  // All args here are hardcoded string literals (see call sites below), so
  // string-joining for the shell is safe — nothing derived from untrusted
  // input ever passes through this function.
  const commandLine = [command, ...args].join(" ");
  log(`${cwd ? `(${cwd}) ` : ""}${commandLine}`);
  execSync(commandLine, { cwd, stdio: "inherit" });
}

// 1. Build apps/api and packages/shared fresh — this script always packages
// whatever their current source compiles to, never a stale dist/.
run("pnpm", ["--filter", "@ai-agent/shared", "build"], repoRoot);
run("pnpm", ["--filter", "@ai-agent/api", "build"], repoRoot);

for (const requiredPath of [
  join(apiSrcRoot, "dist", "app.js"),
  join(apiSrcRoot, "prisma", "schema.prisma"),
  join(sharedSrcRoot, "dist", "index.js"),
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Expected build output missing: ${requiredPath}`);
  }
}

// 2. Start clean.
rmSync(targetRoot, { recursive: true, force: true });
mkdirSync(targetRoot, { recursive: true });

// 3. Copy compiled JS + the Prisma schema/migrations (never dev.db/test.db
// — a packaged app must never ship someone else's local database).
cpSync(join(apiSrcRoot, "dist"), join(targetRoot, "dist"), { recursive: true });

function copySchema(destDir) {
  mkdirSync(destDir, { recursive: true });
  cpSync(join(apiSrcRoot, "prisma", "schema.prisma"), join(destDir, "schema.prisma"));
  cpSync(join(apiSrcRoot, "prisma", "migrations"), join(destDir, "migrations"), { recursive: true });
}

// Two copies, deliberately, not one:
// - resources/api/prisma/ (conventional location): @prisma/client's own
//   postinstall (`prisma generate`, triggered by `npm install` in step 5)
//   looks for `./prisma/schema.prisma` relative to its cwd and needs it
//   *at build time* to generate the client — it doesn't need it again once
//   the client is generated.
// - resources/api/dist/prisma/ (nested under dist/): what migrate.ts
//   actually reads *at runtime* (see api-location.ts's fallback there). An
//   NSIS packaging quirk (see docs/WINDOWS_PACKAGING.md's Phase 4.7
//   section) silently drops a top-level `resources/api/prisma/` folder
//   from what the installer actually writes to disk, even though the exact
//   same bytes are verifiably present and byte-correct in the installer's
//   own archive (a direct `7z x` extraction reproduces them perfectly —
//   only the NSIS runtime's own install step loses them). The nested copy,
//   inside `dist/`, is proven to survive installation intact, so that's
//   the one the running app actually depends on; the top-level one is
//   purely a build-time convenience for `prisma generate` and is fine to
//   lose at install time.
copySchema(join(targetRoot, "prisma"));
copySchema(join(targetRoot, "dist", "prisma"));

// 4. A minimal package.json for the runtime deps that *are* on the
// registry — same version ranges as apps/api/package.json, minus
// @ai-agent/shared (step 4) and devDependencies (not needed at runtime).
const apiPackageJson = JSON.parse(readFileSync(join(apiSrcRoot, "package.json"), "utf-8"));
const runtimeDependencies = { ...apiPackageJson.dependencies };
delete runtimeDependencies["@ai-agent/shared"];
writeFileSync(
  join(targetRoot, "package.json"),
  JSON.stringify(
    {
      name: "ai-agent-api-runtime",
      private: true,
      version: apiPackageJson.version,
      type: "module",
      main: "dist/app.js",
      dependencies: runtimeDependencies,
    },
    null,
    2,
  ),
);

// 5. Plain `npm install` — deliberately not pnpm (see the module comment
// above) — for fastify/googleapis/openai/zod/dotenv/@prisma/client/prisma.
// @prisma/client's postinstall runs `prisma generate` against the schema
// copied in step 3, producing node_modules/.prisma/client with the native
// query engine for this platform.
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], targetRoot);

// 6. @ai-agent/shared is a workspace-only package (not on the npm
// registry), so it can't go through `npm install` above — drop its
// compiled output straight into node_modules as a real directory,
// *after* npm install, not before: npm prunes anything under
// node_modules/ it doesn't recognize from package.json's own dependency
// tree, so placing this first (as an earlier version of this script did)
// silently lost it on every run — a real bug, only caught by actually
// running the installed app's server code and hitting the resulting
// ERR_MODULE_NOT_FOUND for '@ai-agent/shared', not by any build-log output.
const sharedTarget = join(targetRoot, "node_modules", "@ai-agent", "shared");
mkdirSync(sharedTarget, { recursive: true });
cpSync(join(sharedSrcRoot, "dist"), join(sharedTarget, "dist"), { recursive: true });
cpSync(join(sharedSrcRoot, "package.json"), join(sharedTarget, "package.json"));

for (const requiredPath of [
  join(targetRoot, "node_modules", "@prisma", "client"),
  join(targetRoot, "node_modules", "prisma", "build", "index.js"),
  join(sharedTarget, "dist", "index.js"),
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Expected dependency missing after npm install: ${requiredPath}`);
  }
}

log(`Done — standalone api resources ready at ${targetRoot}`);
