# Single-Process Desktop Architecture (Phase 4.2)

The API no longer needs to be started separately. Electron's main process
starts it in-process, on a dynamically chosen free port — no more running
`pnpm dev` in one terminal and `electron .` in another.

## How it works

`apps/desktop/src/main/api-server.ts`'s `startEmbeddedApiServer()`:

1. Dynamically `import()`s `@ai-agent/api` (not a static top-level import —
   see below for why) and calls its exported `buildApp()`.
2. Calls `server.listen({ port: 0, host: "127.0.0.1" })` — port `0` means
   the OS assigns any free port.
3. Reads the actual bound port back off `server.server.address()` and
   returns `{ url: "http://127.0.0.1:<port>", close }`.

`apps/desktop/src/main/index.ts` calls this once, in `app.whenReady()`,
before creating the overlay window — the desktop's existing `ApiClient`
(`createApiClient(url)`, unchanged) is pointed at whatever URL came back,
instead of a hardcoded `http://localhost:4000`.

## Why a dynamic `import()`, not a static one

`@ai-agent/api`'s module graph validates required environment variables
(`DATABASE_URL`, etc.) via Zod **at module-load time** (`config/env.ts`).
A static top-level `import { buildApp } from "@ai-agent/api"` would run
that validation the moment Electron loads `index.js` — before `app code`
has a chance to run, before `app.whenReady()`, with no way to catch the
error. It would crash the whole app with an unhandled exception and a
useless native crash dialog. The dynamic `import()` inside
`startEmbeddedApiServer()` defers that until `index.ts`'s own `try/catch`
is already in place, so a real config problem shows a real
`dialog.showErrorBox()` message instead.

## Real risk, actually tested — not assumed

The main open question going into this phase was whether Prisma's native
query engine (an N-API `.node` binary, ABI-sensitive) would even load
inside Electron's main process — Electron sometimes needs native modules
rebuilt against its own Node ABI. **This was tested for real, not just
typechecked**: built the desktop app, launched actual Electron
(`npx electron .`) against the real dev SQLite database, and confirmed via
the main process's own log output that:

- the embedded server bound to a genuine dynamic port (`55104` in the test
  run, not `4000`),
- Prisma's SQLite engine loaded and ran real queries
  (`SELECT ... FROM User`, `SELECT ... FROM Intervention`) inside
  Electron's process with no ABI errors,
- `GET /api/v1/interventions` returned `200` with real data end-to-end
  through the full embedded stack.

No `engineType = "binary"` override or `electron-rebuild` step was needed —
it works with Prisma's default configuration on this Electron version (32).

## Graceful shutdown

`index.ts` intercepts `before-quit`: if the embedded server is running, it
prevents the default quit, awaits `server.close()` (releasing the SQLite
file handle and the port), then calls `app.quit()` again — the second time
through, `embeddedApi` is already `null`, so it quits normally. Verified
for real: closed the Electron window, confirmed the process exited and the
port was no longer listening.

## Escape hatch: `DESKTOP_API_URL`

If set, the desktop app points at that URL instead of starting an embedded
server — useful for advanced dev workflows (e.g. pointing the desktop app
at a `pnpm dev` API instance running separately, for faster iteration on
API changes without rebuilding the desktop app). Not the default path;
most development and all normal usage goes through the embedded server.

## What did *not* change

- `ApiClient`'s interface and `createApiClient()` — unchanged.
- The IPC handlers (`register-ipc.ts`) — unchanged, still take `apiUrl` as
  a parameter, now just receiving the dynamic URL instead of a static one.
- Any route, service, domain, or repository code in `apps/api` — this
  phase only added a `main`/`exports` entry to `apps/api/package.json` so
  it can be imported as a library; no behavior changed.
- The renderer (React UI) — untouched.

## Tests

`apps/desktop/src/main/api-server.test.ts` — 4 tests, mocking
`@ai-agent/api`'s `buildApp`: dynamic port request shape, URL resolution
from the bound address, graceful close, and error propagation (missing
address / a `listen()` failure such as missing required config). Full
desktop suite: 18/19 passing (the 1 failure is the pre-existing,
unrelated "Assistant character" alt-text mismatch from Phase 2.1).

## Still not done (later Phase 4 sub-phases)

No settings UI, no `safeStorage`, no auto-migration on first launch, no
Windows packaging. `.env` is still how the app is configured — this phase
only removed the "two terminals" problem, nothing else about setup changed.
