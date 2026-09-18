import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Phase 4.6: locates the on-disk `@ai-agent/api` package this process
 * should run — its compiled `dist/app.js`, its `prisma/schema.prisma` +
 * migrations, and (for the migration step) a `prisma` CLI it can resolve
 * from that root's own `node_modules`.
 *
 * - Dev/unpackaged: `apps/api` is always this file's sibling under `apps/`
 *   in this monorepo layout, whether this runs from `src/` (tsx/vitest) or
 *   `dist/` (tsc) — both sit one level under `apps/desktop`. Its own real
 *   (pnpm-symlinked) `node_modules` is used as-is.
 * - Packaged: electron-builder's `extraResources` step (see
 *   `scripts/prepare-api-resources.mjs`) copies a standalone, real
 *   (non-symlinked) build of `apps/api` — `dist/`, `prisma/`, and a fresh
 *   `npm install` of only its two native/workspace-only dependencies
 *   (`@prisma/client`, `prisma`) — to `resources/api` alongside the
 *   executable. `process.resourcesPath` is Electron's own pointer to that
 *   directory.
 */
export interface ResolveApiRootOptions {
  isPackaged: boolean;
  resourcesPath: string;
}

export function resolveApiRoot({ isPackaged, resourcesPath }: ResolveApiRootOptions): string {
  if (isPackaged) {
    return join(resourcesPath, "api");
  }
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "api");
}
