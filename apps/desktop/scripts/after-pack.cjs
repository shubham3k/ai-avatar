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
const { cpSync, existsSync } = require("node:fs");
const { join } = require("node:path");

module.exports = async function afterPack(context) {
  const source = join(context.packager.projectDir, "resources", "api");
  const destination = join(context.appOutDir, "resources", "api");

  if (!existsSync(source)) {
    throw new Error(`afterPack: expected ${source} to exist — run "npm run prepare:api" first.`);
  }

  cpSync(source, destination, { recursive: true });
  console.log(`[after-pack] copied ${source} -> ${destination}`);
};
