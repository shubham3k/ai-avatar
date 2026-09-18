import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Phase 4.2: starts the Fastify API in-process (inside Electron's main
 * process), instead of requiring a separately-started `pnpm dev` server on
 * a hardcoded port. A dynamic `import()` (not a static top-level import)
 * is deliberate: `@ai-agent/api` validates required env vars at
 * module-load time, and a static import would crash Electron with an
 * unhandled exception before app code ever runs. This way the caller can
 * catch it and show a real error instead.
 *
 * Phase 4.6: imports `<apiRoot>/dist/app.js` by absolute file URL rather
 * than the bare `"@ai-agent/api"` package specifier — the bare specifier
 * only resolves via node_modules (dev's pnpm workspace symlink); a
 * packaged build instead has a standalone, real copy of the api package at
 * `resources/api` (see `api-location.ts` / `scripts/prepare-api-resources.mjs`),
 * which isn't reachable through package resolution at all. The same
 * file-path import works unchanged for both cases.
 *
 * Phase 4.7: was `port: 0` (OS-assigned, different every launch) until
 * Google OAuth needed a fixed, predictable port — Google requires an
 * OAuth "Web application"-type client's redirect URI to match exactly,
 * port included, and this app's existing (already real-world-tested)
 * Google credentials are registered against a fixed port. A random port
 * every launch would never match. `DEFAULT_PORT` (4000) matches what
 * those credentials already expect; not overridable per-request, since
 * changing it would silently break Google sign-in until the redirect URI
 * registered with Google was updated to match.
 */
const DEFAULT_PORT = 4000;

export interface EmbeddedApiServer {
  url: string;
  close(): Promise<void>;
}

interface FastifyLikeInstance {
  listen(opts: { port: number; host: string }): Promise<void>;
  close(): Promise<void>;
  server: { address(): { port: number } | string | null };
}

export interface StartEmbeddedApiServerOptions {
  /** The `@ai-agent/api` package root — see api-location.ts's `resolveApiRoot()`. */
  apiRoot: string;
  /** Injectable for tests, to avoid depending on a real built `dist/app.js` on disk. */
  importApiModule?: (entryUrl: string) => Promise<{ buildApp: () => FastifyLikeInstance }>;
  /** Defaults to DEFAULT_PORT (4000) — see the module comment for why this isn't dynamic. */
  port?: number;
}

export async function startEmbeddedApiServer(
  options: StartEmbeddedApiServerOptions,
): Promise<EmbeddedApiServer> {
  const importApiModule = options.importApiModule ?? ((url: string) => import(url));
  const entryPath = join(options.apiRoot, "dist", "app.js");
  const { buildApp } = await importApiModule(pathToFileURL(entryPath).href);
  const server = buildApp();

  await server.listen({ port: options.port ?? DEFAULT_PORT, host: "127.0.0.1" });

  const address = server.server.address();
  const port = address && typeof address === "object" ? address.port : null;
  if (!port) {
    await server.close();
    throw new Error("Could not determine the local API server's port.");
  }

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
  };
}
