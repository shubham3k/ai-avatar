/**
 * Phase 4.6/4.7: electron-builder's `extraResources` is unreliable for
 * `resources/api` in two distinct, empirically-confirmed ways:
 *
 * 1. It categorically strips any directory literally named `node_modules`,
 *    even with an explicit `filter: ["**\/*"]` override — confirmed by
 *    inspecting a real `--dir` build's output.
 * 2. Separately, building the NSIS target drops `resources/api/prisma/`
 *    (schema.prisma + migrations) from the installer archive entirely —
 *    confirmed by listing the built installer .exe's contents with 7-Zip
 *    (`7za l`) — even though that same folder is correctly present on disk
 *    in the `win-unpacked` directory NSIS archives from. The `--dir` target
 *    doesn't have this problem; only the NSIS archive-building step does.
 *
 * Rather than keep fighting electron-builder's internal file-manifest
 * logic, this `afterPack` hook just copies the *entire* `resources/api`
 * tree wholesale into the packaged app after electron-builder is done —
 * proven reliable already for `node_modules` (files added here are
 * confirmed, via the same `7za l` inspection, to actually make it into the
 * NSIS archive, unlike extraResources-copied files). The source is a
 * plain, fully real (non-symlinked) directory tree — produced by
 * `prepare-api-resources.mjs`'s plain `npm install`, not pnpm — so a
 * straightforward recursive copy is correct with no symlink concerns.
 */
const { cpSync, existsSync, readdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");

/** Every node_modules/.bin folder under a directory (not following links). */
function findBinDirs(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name === ".bin" && dir.endsWith("node_modules")) found.push(path);
      else walk(path);
    }
  };
  walk(root);
  return found;
}

module.exports = async function afterPack(context) {
  const source = join(context.packager.projectDir, "resources", "api");
  // ADR-007: on macOS the resources live inside the bundle
  // (<App>.app/Contents/Resources — Electron's process.resourcesPath there),
  // and this runs before electron-builder signs the app, so the copied
  // native modules get signed with it.
  const destination =
    context.electronPlatformName === "darwin"
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources", "api")
      : join(context.appOutDir, "resources", "api");

  if (!existsSync(source)) {
    throw new Error(`afterPack: expected ${source} to exist — run "npm run prepare:api" first.`);
  }

  // verbatimSymlinks: keep npm's relative links relative — by default cpSync
  // rewrites them to absolute paths back into resources/api, and macOS
  // refuses to sign a bundle whose links point outside it ("invalid
  // destination for symbolic link in bundle", ADR-007).
  cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
  if (context.electronPlatformName === "darwin") {
    // The app runs the Prisma CLI and the MCP server by resolved path, never
    // through node_modules/.bin, so drop those link folders from the bundle.
    for (const binDir of findBinDirs(destination)) rmSync(binDir, { recursive: true, force: true });
  }
  console.log(`[after-pack] copied ${source} -> ${destination}`);
};
