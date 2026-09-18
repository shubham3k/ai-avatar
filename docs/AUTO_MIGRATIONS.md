# Auto-Run Prisma Migrations on First Launch (Phase 4.5)

A fresh clone/install no longer needs a manual `pnpm db:migrate` step
before the desktop app works — Electron's main process now applies any
pending Prisma migrations itself before starting the embedded API.

## How it works

`apps/desktop/src/main/migrate.ts`'s `runMigrations()`:

1. Locates `apps/api/prisma/schema.prisma` relative to this module's own
   file location (a fixed sibling of `apps/desktop` in this monorepo
   layout — see "Why a relative path" below).
2. Resolves the `prisma` CLI's entry point (`prisma/build/index.js`) via a
   `require()` rooted at `apps/api`'s own `package.json` — `prisma` is one
   of its dependencies.
3. Spawns `<node> <prisma-cli> migrate deploy --schema <schemaPath>` with
   `DATABASE_URL` set (from the environment, or `apps/api`'s own
   `file:./dev.db` default) and waits for it to exit.

`index.ts` calls `await runMigrations()` in `app.whenReady()`, immediately
before `startEmbeddedApiServer()` (Phase 4.2), inside the same `try/catch`
— a migration failure shows the same in-app startup error screen (Phase
4.3) as an embedded-API startup failure, rather than a silent blank overlay
or a native crash dialog.

## Why `migrate deploy`, not `migrate dev`

`migrate dev` is interactive: it can prompt, create/reset a shadow
database, and generate new migrations from schema drift. None of that
belongs in an app's startup path. `migrate deploy` only applies
already-committed migration files from `prisma/migrations/` — no prompts,
no shadow database, safe to run unattended.

## Why every launch, not just the first

`migrate deploy` is idempotent — a no-op ("No pending migrations to
apply.") once the schema is current. Running it unconditionally on every
launch is simpler and more robust than tracking a separate "is this the
first launch" flag, and it self-heals: a future app update that ships a
new migration is applied automatically on the next launch, not just on a
literal first install.

## Why a relative path, not package resolution

`@ai-agent/api`'s `package.json` declares an `"exports"` map with only an
`"import"` condition. That makes the package specifier unusable for
locating `prisma/schema.prisma` two different ways:

- `require.resolve("@ai-agent/api/...")` fails outright
  (`ERR_PACKAGE_PATH_NOT_EXPORTED` / "No exports main defined") — there's
  no `"require"` condition for CJS resolution to fall back to.
- `import.meta.resolve("@ai-agent/api")` works under real Node/Electron,
  but Vitest's Vite-SSR test transform doesn't implement
  `import.meta.resolve` at all, breaking the unit tests.

Instead, `migrate.ts` walks up from its own `import.meta.url`: this file
always lives at `apps/desktop/{src,dist}/main/migrate.{ts,js}`, and
`apps/api` is always its sibling under `apps/` — true in dev and in the
current (unpackaged) build alike. `existsSync` guards the computed path so
a broken assumption fails with a clear error instead of a confusing spawn
failure. **This will need revisiting if Phase 4.6 packaging changes the
on-disk layout** (e.g. bundling `apps/api` into a different relative
location via `extraResources`).

## The real bug this caught: `process.execPath` inside Electron

The first implementation used `spawn(process.execPath, [prismaCliPath, ...])`
— correct under plain Node (where `process.execPath` is `node.exe`), but
**inside Electron's main process, `process.execPath` is `electron.exe`**.
Spawning `electron.exe <prisma-cli-script> migrate deploy ...` without
`ELECTRON_RUN_AS_NODE=1` tries to launch another Electron app instead of
running the script as plain Node — the embedded API server never started,
and the window never appeared (`MainWindowHandle` stayed `0` for every
process). This was invisible in the plain-Node unit tests and in a direct
`node dist/main/migrate.js` smoke test — it only showed up on a **real,
non-mocked `npx electron .` launch**, which is exactly why that launch was
done as part of verifying this phase. Fixed by adding
`ELECTRON_RUN_AS_NODE: "1"` to the spawned child's environment — a no-op
when `process.execPath` is already plain Node (tests, `apps/api` run
standalone).

## `prisma` moved from a devDependency to a dependency

`apps/api/package.json` previously listed `prisma` (the CLI) only as a
devDependency, since only `pnpm db:migrate`/`pnpm prisma:*` scripts used
it. Since the desktop app now needs to resolve and run it at runtime — not
just during development — it moved to `dependencies`. `@prisma/client` was
already a runtime dependency.

## Real (non-mocked) verification

1. Backed up and deleted the real `apps/api/prisma/dev.db` to simulate a
   fresh install, then ran the compiled `runMigrations()` directly against
   it (`node -e "import('./dist/main/migrate.js')..."`) — confirmed a
   fresh SQLite file was created with all 9 expected tables (`User`,
   `Intervention`, `Signal`, `Email`, `CalendarEvent`, `Integration`,
   `AgentRun`, `Goal`, `_prisma_migrations`), verified via a direct Prisma
   Client query, not just "the file exists."
2. Ran `runMigrations()` a second time against that same fresh database —
   confirmed it completes cleanly with no error (the "no pending
   migrations" idempotent path).
3. Restored the original `dev.db` (with its existing demo data) afterward
   — this phase didn't touch the real dev database's contents.
4. **Caught the `ELECTRON_RUN_AS_NODE` bug above** via a genuinely first
   attempt at launching real Electron (`npx electron .`, Vite dev server
   running) that hung with no window and no bound port. After the fix, a
   second real Electron launch: the embedded API bound a real dynamic port
   (`64182` in the test run), `GET /api/v1/health` and
   `GET /api/v1/interventions` both responded correctly through it, and
   the Electron process's window handle was non-zero (a real window
   existed, unlike the hung first attempt). Closed the window and
   confirmed all Electron processes exited and the port was released.

## Tests

`apps/desktop/src/main/migrate.test.ts` — 5 tests (child_process mocked via
an injectable `spawnFn`, matching this codebase's existing DI pattern):
correct CLI invocation shape (including `ELECTRON_RUN_AS_NODE: "1"`),
`DATABASE_URL` fallback chain, success on exit code 0 (including the
"no pending migrations" case), rejection with captured output on a
non-zero exit, rejection if the process fails to spawn at all. Full
desktop suite: 44/45 passing (the 1 failure is the same pre-existing,
unrelated Phase 2.1 alt-text mismatch). Typecheck/lint clean.

## What did *not* change

- `apps/api`'s routes, services, domain, or repository code — untouched.
- The Prisma schema and migration files themselves — untouched.
- `api-server.ts` / `startEmbeddedApiServer()` — unchanged; migrations run
  as a separate step immediately before it, not inside it.
- The renderer (React UI) — untouched; a migration failure surfaces
  through the exact same `startupError` string/UI Phase 4.3 already built
  for an embedded-API startup failure.

## Still not done (later Phase 4 sub-phases)

No Windows packaging (Phase 4.6) — this phase only removed the manual
migration step for the current (unpackaged) monorepo layout. The relative
sibling-path assumption above, and whether `prisma`'s CLI (and its native
query-engine binaries) survive being bundled by `electron-builder`, are
both open questions for Phase 4.6, not resolved here.
