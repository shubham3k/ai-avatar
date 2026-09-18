import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

/**
 * Phase 4.5: runs `prisma migrate deploy` against the embedded SQLite
 * database before the API starts, so a fresh clone/install no longer needs
 * a manual `pnpm db:migrate` step. `migrate deploy` (not `migrate dev`) is
 * deliberate — it only applies already-committed migrations, never prompts,
 * never touches a shadow database, and is safe to run unconditionally on
 * every launch (a no-op once the schema is current), so there's no need for
 * a separate "is this the first launch" flag to get wrong.
 *
 * Shelling out to the `prisma` CLI (rather than a programmatic API) is
 * intentional: Prisma does not publish a stable public API for running
 * migrations, so the CLI is the only supported way to do this outside
 * `prisma migrate dev`'s interactive flow.
 */
export interface RunMigrationsOptions {
  /** The `@ai-agent/api` package root — see api-location.ts's `resolveApiRoot()`. */
  apiRoot: string;
  /** Defaults to process.env.DATABASE_URL, then apps/api's own default. */
  databaseUrl?: string;
  spawnFn?: typeof spawn;
}

export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const spawnFn = options.spawnFn ?? spawn;
  const apiPackageRoot = options.apiRoot;

  // Dev: apps/api's own prisma/schema.prisma. Packaged: dist/prisma/schema.prisma
  // — deliberately nested under dist/ rather than a sibling of it; see
  // prepare-api-resources.mjs for why (an NSIS installer quirk drops a
  // top-level resources/api/prisma/ folder from what actually gets written
  // to disk, even though the installer's own archive has it byte-correct).
  const devSchemaPath = join(apiPackageRoot, "prisma", "schema.prisma");
  const packagedSchemaPath = join(apiPackageRoot, "dist", "prisma", "schema.prisma");
  const schemaPath = existsSync(devSchemaPath) ? devSchemaPath : packagedSchemaPath;
  if (!existsSync(schemaPath)) {
    throw new Error(
      `Could not find the database schema at ${devSchemaPath} or ${packagedSchemaPath}.`,
    );
  }

  // "prisma" (the CLI) is a plain CJS-resolvable dependency of @ai-agent/api
  // itself (not exports-restricted), so a require() rooted at the api
  // package's own directory finds it correctly via node_modules resolution
  // — in dev, its real (pnpm-symlinked) node_modules; when packaged, the
  // fresh `npm install` that `scripts/prepare-api-resources.mjs` runs.
  const require = createRequire(join(apiPackageRoot, "package.json"));
  const prismaCliPath = require.resolve("prisma/build/index.js");

  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? "file:./dev.db";

  await new Promise<void>((resolve, reject) => {
    const child = spawnFn(
      process.execPath,
      [prismaCliPath, "migrate", "deploy", "--schema", schemaPath],
      {
        cwd: apiPackageRoot,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          // Inside Electron's main process, process.execPath is the
          // electron.exe binary, not a plain node binary — without this,
          // spawning it would try to launch another Electron app rather
          // than run the prisma CLI as a Node script. Harmless when
          // process.execPath is already plain node (tests, `apps/api`
          // run standalone).
          ELECTRON_RUN_AS_NODE: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to start database migration: ${err.message}`));
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Database migration failed (exit code ${code}):\n${output.trim()}`));
      }
    });
  });
}
