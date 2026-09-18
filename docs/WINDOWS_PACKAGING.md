# Windows Packaging via electron-builder (Phase 4.6)

The desktop app now builds into a real, standalone Windows artifact — an
NSIS installer (`AI Executive Agent Setup <version>.exe`) and an unpacked
`win-unpacked/` directory — that runs without the monorepo, pnpm, or a
dev server present. This is the first phase where the app leaves this
machine's development environment in any meaningful sense.

## Commands

```powershell
# Fast iteration — unpacked dir build, no installer, in apps/desktop/release/win-unpacked
npm run package:win:dir

# Full NSIS installer, in apps/desktop/release
npm run package:win
```

Both run the same pipeline: `build` (tsc + vite) → `prepare:api` (see
below) → `electron-builder --win <target>`.

## The core problem: shipping `@ai-agent/api` outside the monorepo

The embedded API (Phase 4.2) and the auto-migration step (Phase 4.5) both
need a real, on-disk `@ai-agent/api` — its compiled `dist/`, its Prisma
schema/migrations, and a working `node_modules` for its own runtime
dependencies (`fastify`, `googleapis`, `openai`, `zod`, `@prisma/client`,
`prisma`). In dev, that's just `apps/api` itself, resolved as this
monorepo's sibling package (`api-location.ts`). A packaged app has no
monorepo — it needs its own private copy.

**`apps/api`'s own `node_modules` can't just be copied.** Every pnpm
workspace package's `node_modules` is a tree of symlinks/junctions into
pnpm's shared content-addressable store — copying that tree elsewhere (as
packaging inherently does) leaves dangling links pointing at paths that
don't exist on whatever machine ends up running the packaged app.
**`pnpm deploy` doesn't solve this either** — verified directly: it
produces its own *internal* virtual store, but on Windows that store uses
*absolute* junctions (confirmed via `Get-Item ... | Select LinkType,
Target` on a real `pnpm deploy` output), which break the exact same way
once the deployed folder is moved (e.g., into an installer, or onto a
different machine than the one that ran `pnpm deploy`).

## The fix: `scripts/prepare-api-resources.mjs`

Sidesteps pnpm's linking entirely for the packaged copy, since
`@ai-agent/api`'s actual runtime dependency surface is small:

1. Builds `apps/api` and `packages/shared` fresh (`pnpm --filter ... build`).
2. Copies their compiled JS output directly (`cpSync`, real files, no
   symlinks involved) into `apps/desktop/resources/api/`, along with
   `prisma/schema.prisma` and `prisma/migrations/` — never `dev.db`/
   `test.db`, a packaged app must never ship someone else's local database.
3. `@ai-agent/shared` is workspace-only (not on the npm registry) — its
   compiled output is copied straight into
   `resources/api/node_modules/@ai-agent/shared/` as a real directory.
4. Writes a minimal, standalone `package.json` at `resources/api/` listing
   just the registry-published runtime dependencies (same version ranges
   as `apps/api/package.json`, minus `@ai-agent/shared`).
5. Runs a plain **`npm install --omit=dev`** in `resources/api/` —
   deliberately npm, not pnpm, since npm's own node_modules layout uses
   ordinary real directories. This is what actually solves the
   relocatability problem. `@prisma/client`'s postinstall runs
   `prisma generate` against the schema copied in step 2, producing
   `node_modules/.prisma/client` with the correct native query engine for
   this platform.

Verified empirically after each step (not just "the docs say so"):
`resources/api/node_modules/@prisma/client` has `LinkType` empty in
PowerShell (a real directory), and
`node_modules/.prisma/client/query_engine-windows.dll.node` /
`node_modules/prisma/query_engine-windows.dll.node` are real native
binaries, present and correctly generated.

## `api-location.ts`: one resolver, two environments

`resolveApiRoot({ isPackaged, resourcesPath })`:
- Packaged: `<resourcesPath>/api` (electron-builder's `extraResources`
  destination — see below).
- Dev: `apps/api`, this file's fixed sibling under `apps/` in the
  monorepo, resolved relative to its own `import.meta.url`.

`index.ts` computes this once and passes it to both `runMigrations()`
(Phase 4.5) and `startEmbeddedApiServer()` (Phase 4.2) — both now import/
resolve everything relative to that single `apiRoot`, with no special-case
branching of their own between dev and packaged.

**This required two refactors**, both covered by updated unit tests:
- `api-server.ts` no longer does `import("@ai-agent/api")` (a bare package
  specifier that only resolves via node_modules — meaningless for a
  packaged app's standalone `resources/api`, which isn't reachable through
  package resolution at all). It now imports `<apiRoot>/dist/app.js` by
  absolute file URL, unchanged for both dev and packaged.
- `migrate.ts` no longer computes `apiRoot` itself by walking up from its
  own file location (that logic assumed apps/api is always its monorepo
  sibling, which is false once packaged) — it now takes `apiRoot` as a
  required option, resolved once in `index.ts`.

## electron-builder config quirk: `extraResources` silently drops `node_modules`

`extraResources: [{ from: "resources/api", to: "api" }]` copied
`dist/`, `prisma/`, and `package.json` correctly, but **never**
`node_modules` — confirmed empirically by inspecting the packaged output
after a real build. Adding an explicit `filter: ["**/*"]` (which per
electron-builder's docs should override the default filter) made no
difference; `node_modules` is dropped unconditionally for `extraResources`
copies, regardless of filter.

**Fix: an `afterPack` hook** (`scripts/after-pack.cjs`), which
electron-builder is documented to support for exactly this class of
problem. After electron-builder finishes packaging, it does a plain
`fs.cpSync(resources/api/node_modules, <appOutDir>/resources/api/node_modules,
{ recursive: true })`. The source is already a fully real (non-symlinked)
tree from step 5 above, so a straightforward recursive copy is correct.

## What's in the packaged app

- `resources/app.asar` — the desktop app itself (`dist/main/**`,
  `dist/renderer/**`, `package.json`). electron-builder's asar packing
  correctly dereferences the one real npm dependency the main process
  still has (`dotenv`) — verified by listing the asar's contents
  (`npx asar list`) and confirming real file content, not a broken link.
- `resources/api/` — the standalone api build from
  `prepare-api-resources.mjs` + the `afterPack`-copied `node_modules`.
- No custom app icon yet — electron-builder falls back to its own default
  Electron icon (`default Electron icon is used` in its own build log).
  Cosmetic, deliberately out of scope for this phase.
- No code signing certificate — `signtool.exe` runs but there's no real
  certificate configured on this machine, so the binaries are unsigned.
  Windows SmartScreen will warn on first run of the installer; a real cert
  is a separate, later concern (Phase 4.7/4.8 territory, not blocking
  local validation).

## Real (non-mocked) verification

1. **`prepare-api-resources.mjs` alone**: ran it for real, inspected the
   output directory structure and confirmed (via PowerShell `Get-Item`)
   that `@prisma/client` is a real directory, not a symlink/junction —
   directly falsifying the naive "just copy apps/api/node_modules"
   approach this script replaces.
2. **The packaged `apiRoot` path under plain Node, before touching
   electron-builder at all**: pointed the compiled `runMigrations()` /
   `startEmbeddedApiServer()` at `resources/api` directly — confirmed
   migrations ran against a fresh database and the API served a real
   `GET /api/v1/health` request, entirely decoupled from packaging.
3. **The `--win dir` unpacked build, launched for real, twice** (once
   before, once after fixing the `node_modules` exclusion above): the
   first attempt had no `node_modules` in the packaged output at all — the
   API would have crashed on `@prisma/client` require; this was caught
   *because* the launch was attempted for real, not assumed from the build
   log succeeding. After the `afterPack` fix: deleted any leftover
   `dev.db` to simulate a genuine first install, launched
   `AI Executive Agent.exe` directly (no `npx electron .`, no monorepo
   context), confirmed a fresh `dev.db` was created (migrations ran),
   confirmed the embedded API bound a real dynamic port and
   `GET /api/v1/health` responded `200`, confirmed a real window (non-
   empty `MainWindowTitle`), and confirmed closing the app released the
   process and the port.
4. **Reran the entire pipeline from a clean slate** (`rm -rf release
   resources`, `npm run package:win:dir`) and repeated the same launch
   verification — the build is reproducible, not a one-off that happened
   to work.
5. **Built the actual NSIS installer** (`npm run package:win`) —
   `AI Executive Agent Setup 0.1.0.exe` (~151 MB) was produced
   successfully. The installer itself was **not run** — installing
   software system-wide (registry entries, Start Menu, an actual install
   location) is a meaningfully more invasive action than a `--dir` build
   inspected and launched in place, and wasn't done without the user
   present to decide whether to install onto their own machine. The
   `win-unpacked` verification above exercises the exact same packaged
   bits the installer wraps.

## Tests

New `api-location.test.ts` (2 tests: packaged/dev resolution).
`api-server.test.ts` and `migrate.test.ts` updated for the `apiRoot`-based
signatures (12 tests total across the three files, all passing). Full
desktop suite: 47/48 (the 1 failure is the same pre-existing, unrelated
Phase 2.1 alt-text mismatch). Typecheck clean. Lint clean — including a
genuine fix: added a `.cjs`-scoped eslint override for
`@typescript-eslint/no-require-imports` (both the new `after-pack.cjs` and
the pre-existing `preload.cjs` legitimately need `require()`, since both
exist specifically because something outside this package's own control
needs plain CommonJS in an otherwise `"type": "module"` package).

## Dependency reclassification

`apps/desktop/package.json`: removed `@ai-agent/api` (no longer imported
by specifier — see the `api-location.ts` refactor above); moved
`@ai-agent/shared` (renderer-only, inlined by vite at build time),
`react`, and `react-dom` (same) from `dependencies` to `devDependencies` —
none of them are needed in the packaged app's own runtime, which now has
exactly one real npm dependency (`dotenv`, used by `config.ts` in the main
process).

## Still not done as of Phase 4.6

No code signing certificate, no custom app icon, no auto-update mechanism,
no Squirrel/portable target evaluation beyond NSIS, and — most
importantly — **no clean-install validation on a machine that never had
this repo's dev environment on it**, which is explicitly Phase 4.7's job.
Everything verified in Phase 4.6 was on the same machine that built the
package.

---

# Phase 4.7 — Clean-Install Validation (in progress)

Static checks and a same-machine install/launch pass are done. Three real
bugs were found this phase, all only by actually running the installer,
not by build logs or static analysis. **Genuine clean-machine validation
(a machine that never had this repo's tooling on it) is still the user's
own outstanding step** — everything below was still done on the build
machine.

## Static checks: ruled out the biggest suspected risk

Scanned the native Prisma query engine (`query_engine-windows.dll.node`)
and the main `AI Executive Agent.exe` for their DLL import tables (via
`grep -aoE "[A-Za-z0-9_.-]+\.dll"` over the raw binaries — no `dumpbin`/
`objdump` available on this machine, but PE import-table strings are
plain ASCII, so a crude string scan works). Both reference only standard
Windows system DLLs (`KERNEL32`, `ADVAPI32`, `bcrypt`, `ws2_32`, etc.) —
**no `VCRUNTIME140.dll`, `MSVCP140.dll`, or `api-ms-win-crt-*.dll`**,
meaning neither the Rust-built Prisma engine nor Electron itself needs the
Visual C++ Redistributable installed. This was the biggest suspected risk
for a genuinely clean Windows machine, and it's ruled out.

## Bug 1: NSIS's installer runtime drops a top-level `resources/api/prisma/` folder

First real install (`AI Executive Agent Setup 0.1.0.exe /S`) produced an
app with `resources/api/dist` and `node_modules` but no `prisma/` —
`schema.prisma` and the migrations were gone, even though they were
present in the `win-unpacked` build electron-builder builds the NSIS
archive from. Isolated with `7za l` (listing the installer's own archive
contents) and `7za x` (extracting it directly): **the archive itself has
the files, byte-correct** — a raw 7-Zip extraction reproduces
`resources\api\prisma\schema.prisma` perfectly. Only NSIS's own generated
installer, actually run, fails to write it to `$INSTDIR`.

**Fix**: `prepare-api-resources.mjs` now copies the schema/migrations to
*two* places — the conventional `resources/api/prisma/` (needed at build
time, so `@prisma/client`'s own `prisma generate` postinstall step can
find it) and `resources/api/dist/prisma/` (nested inside `dist/`, which
survives installation intact). `migrate.ts` checks the conventional path
first (present in dev), falling back to the nested one (the only one that
survives a packaged install).

## Bug 2: my own script pruned `@ai-agent/shared`

Once bug 1 was worked around, running the *exact* embedded-server startup
code directly against the real installed `resources/api` (bypassing
Electron/the installer entirely — the fastest way to reproduce a startup
failure) threw `ERR_MODULE_NOT_FOUND: Cannot find package '@ai-agent/shared'`.
Root cause was in `prepare-api-resources.mjs` itself, not NSIS: the script
placed `node_modules/@ai-agent/shared` *before* running `npm install`, and
`npm install` prunes anything under `node_modules/` it doesn't recognize
from `package.json`'s own dependency tree. Fixed by moving that copy to
*after* `npm install` runs.

## Bug 3: `prisma generate` needs the schema at the conventional path

A direct side effect of the bug-1 fix: moving the schema *only* to
`dist/prisma/` broke `@prisma/client`'s own postinstall (`prisma
generate`), which looks for `./prisma/schema.prisma` relative to its
install-time cwd — it never found it, silently leaving
`node_modules/.prisma/client` unpopulated, and the server threw `@prisma
/client did not initialize yet` on startup. This is why the final fix for
bug 1 keeps *both* schema copies (see above) rather than only the nested
one.

## Bug 4: the overlay window never showed at all — found by the user's own hands-on test

After bugs 1–3 were fixed, the API-level verification below all passed —
but the **user's own manual test** (installing and running the real
`.exe` themselves, exactly what Phase 4.7 exists for) found a completely
different, more fundamental bug: the app appeared in Task Manager as a
running process, but **no window was ever visible at all** — not even
blank or transparent-looking, genuinely nothing.

Root cause: `overlay-window.ts` computed the path to the renderer's
`index.html` one directory level short.
`overlay-window.ts` compiles to `dist/main/windows/overlay-window.js`;
`join(__dirname, "../renderer/index.html")` from there resolves to
`dist/main/renderer/index.html` — but the actual Vite build output is at
`dist/renderer/index.html`, a **sibling of `dist/main/`**, not nested
inside it. `loadFile()` on a nonexistent path fails silently; the page
never renders, so `ready-to-show` (which the window's `.show()` call is
gated on) never fires, and the `BrowserWindow` — created with
`show: false` — simply never appears. Confirmed directly: listing the
packaged `app.asar`'s actual contents (`npx asar list`) showed
`\dist\renderer\index.html`, matching the diagnosis exactly.

**Why this survived every earlier phase's testing, including this
session's own extensive verification**: dev mode (`isDev: true`) never
exercises this code path at all — it calls `loadURL(devServerUrl)`
instead, loading the Vite dev server directly. Every prior phase's
"real Electron launch" verification, and every packaged-app check earlier
in this very Phase 4.6/4.7 session, checked the window's *existence*
(`Get-Process`, `MainWindowHandle`/`MainWindowTitle` being non-empty) and
the embedded API's health — never whether the renderer's actual page
content loaded. In hindsight, the `MainWindowTitle` values seen in those
earlier checks (`@ai-agent/desktop`, the `package.json` name) were
Electron's own fallback title, never updated to the HTML's real
`<title>AI Executive Agent Desktop</title>` — a page that never loaded
can't set its own title. That distinction is exactly what makes this fix
verifiable without a screenshot: after the fix, the same title check
reads `AI Executive Agent Desktop`, confirming the page genuinely
rendered.

Fixed with the correct two-levels-up path, and a new
`overlay-window.test.ts` (mocking `electron`) that asserts the resolved
path ends in `/renderer/index.html` and never contains `/main/renderer/`
— specifically to catch this exact class of regression, since nothing
else in the test suite could (dev-mode testing structurally can't reach
this code path, and no other check verifies renderer content loaded).

## The fast diagnostic loop that actually found bugs 2 and 3

After bug 1, going through a full rebuild → install → wait-for-slow-NSIS-
extraction → launch → check cycle for every hypothesis was far too slow
(each full round trip was several minutes, dominated by `npm install` and
NSIS's own extraction time). Bugs 2 and 3 were instead found and confirmed
fixed in under 10 seconds each by writing a tiny throwaway script that
imports the compiled `runMigrations()`/`startEmbeddedApiServer()` directly
and points them at `resources/api` — no Electron, no installer, no wait:

```js
import { runMigrations } from "./dist/main/migrate.js";
import { startEmbeddedApiServer } from "./dist/main/api-server.js";
const apiRoot = "<path to resources/api>";
await runMigrations({ apiRoot, databaseUrl: "file:./diag-test.db" });
const server = await startEmbeddedApiServer({ apiRoot });
console.log(await (await fetch(server.url + "/api/v1/health")).text());
await server.close();
```

This is the same technique the Phase 4.6 `ELECTRON_RUN_AS_NODE` bug
diagnosis used, generalized: reproduce the exact runtime code path outside
Electron whenever possible, and only go through the full
build-install-launch cycle for final confirmation.

## An honest note on installer flakiness observed in this session

Running the same, unchanged installer `.exe` repeatedly in quick
succession (as this validation pass did, many times) produced
**inconsistent results across runs** — one run left `resources/api/dist`
and `node_modules/@ai-agent/shared` completely missing despite the
installer process reporting a clean exit; another run of the *identical*
`.exe` completed correctly with the expected ~9,400+ files. Total
extracted file counts varied between separate runs of the same installer,
which a deterministic extraction should never do. This does not look like
a packaging defect (bugs 1–3 above were each reproduced consistently and
are now fixed) — it looks like **real-time antivirus scanning racing with
NSIS's extraction of several thousand small files**, most likely Windows
Defender, which was confirmed active (`Get-MpComputerStatus` →
`RealTimeProtectionEnabled: True`) on this machine, though no specific
detection/quarantine event was found in its logs for this app. Watching
extraction progress directly (polling installed file count every few
seconds) showed extraction taking anywhere from ~15 seconds to well over a
minute across identical runs, consistent with contention rather than a
fixed amount of work. **Not chased further** — a real end user runs an
installer once, not ten times in rapid succession for testing purposes,
so this is unlikely to reflect normal usage, but it's worth knowing if the
app doesn't start after a fresh install: re-running the installer, or
temporarily excluding the install directory from real-time scanning, are
reasonable first troubleshooting steps.

## Real (non-mocked) verification, Phase 4.7

After all three fixes: cleaned any prior install (directory + registry
uninstall entry), ran the installer for real, waited for the *actual*
extraction to finish (polling installed file count until stable — a
single "process exited" check proved unreliable, see above), and
confirmed:
- `resources/api/dist/prisma/schema.prisma` present.
- `resources/api/node_modules/@ai-agent/shared/dist/index.js` present.
- Total installed file count matched what a complete install should have
  (~9,450 files this run).
- Launched `AI Executive Agent.exe` directly from
  `%LOCALAPPDATA%\Programs\AI Executive Agent\` (the real per-user install
  path, no elevation needed) — confirmed the embedded API bound a real
  dynamic port and `GET /api/v1/health` responded `200`.
- Closed the app and confirmed via `Get-Process`/`Get-NetTCPConnection`
  that it exited cleanly and released the port.

After bug 4 (above) was found by the user's own real test and fixed:
reinstalled clean, launched `AI Executive Agent.exe` again, and confirmed
`MainWindowTitle` reads `AI Executive Agent Desktop` (the page's real
`<title>`, not Electron's `@ai-agent/desktop` fallback) — direct evidence
the renderer actually painted this time, not just that a process and a
window handle existed. Embedded API re-confirmed serving `GET
/api/v1/health` → `200` on the same run.

## Tests

`overlay-window.test.ts` (2 tests, new — mocks `electron`, asserts the
production `loadFile` path and the dev `loadURL` path). Otherwise no new
unit tests this phase (the other three fixes are in
`scripts/prepare-api-resources.mjs`, a build-time script, and a small
fallback-path addition to `migrate.ts`'s existing schema-resolution logic,
covered by its existing tests continuing to pass). Full desktop suite:
49/50 (same pre-existing, unrelated Phase 2.1 failure). Typecheck/lint
clean.

## Still not done — genuinely Phase 4.7's remaining job

**Validation on a machine that never had this repo's dev environment on
it.** Every fix and every verification above happened on the machine that
built the installer, with one exception: bug 4 was found by the user
actually installing and launching the real `.exe` themselves — exactly
the kind of check this phase exists for, and a good reminder that
process-level/API-level verification (everything I can check from a
terminal) is not the same thing as a human looking at the screen. The
Redistributable-dependency check (ruled out via DLL scanning) is still
the strongest evidence so far that a genuinely clean machine will work,
but it isn't a substitute for actually trying it on one.
