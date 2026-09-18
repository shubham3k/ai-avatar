# Implementation Checklist

## Before coding
- [ ] Read `AGENTS.md`.
- [ ] Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/PHASE_PLAN.md`.
- [ ] Initialize Git repository.
- [ ] Create `.env` from `.env.example`.
- [ ] Start PostgreSQL.

## Phase 1.1
- [ ] Install workspace dependencies.
- [ ] Create Next.js web app.
- [ ] Create Fastify API.
- [ ] Create Node worker.
- [ ] Create Electron app.
- [ ] Create shared package.
- [ ] Add Prisma and migration.
- [ ] Add demo seed.

## Phase 1.2
- [ ] Health endpoint.
- [ ] Intervention list endpoint.
- [ ] Resolve endpoint.
- [ ] Snooze endpoint.
- [ ] SSE endpoint.
- [ ] Web dashboard.

## Phase 1.3
- [x] Google OAuth (connect/callback/status/disconnect; see `docs/GOOGLE_OAUTH.md`).
- [x] Encrypted refresh token storage.
- [x] Gmail read-only access (fetch; see `docs/GOOGLE_OAUTH.md`).
- [x] Gmail persistence/sync into `Email` table, idempotent (Phase 2.2B; see `docs/GOOGLE_OAUTH.md`).
- [x] Calendar adapter (read-only fetch + idempotent persistence/sync; see `docs/GOOGLE_CALENDAR.md`).
- [ ] Demo/live sync toggle.

## Phase 1.4
- [x] Signal rules (deterministic actionable-email detection, Phase 2.3; see `docs/GMAIL_SIGNALS.md`).
- [x] Signal rules (deterministic upcoming-meeting detection, Phase 2.5; see `docs/CALENDAR_SIGNALS.md`).
- [x] Context builder (deterministic cross-source Gmail+Calendar correlation, Phase 2.6A; see `docs/CROSS_SOURCE_CONTEXT.md`).
- [x] Context-aware signal consolidation (Phase 2.6B; see `docs/CONSOLIDATED_SITUATIONS.md`).
- [x] LLM evaluator (Groq Chat Completions API — swapped from OpenAI during Phase 2 manual validation, advisory-only prioritization of consolidated situations, Phase 2.7; see `docs/AI_PRIORITIZATION.md`).
- [x] Structured output schema (`prioritizationResponseSchema`; Groq structured outputs with per-request situationId enum, Phase 2.7).
- [x] Guardrails (situationId/priority validated and invalid entries dropped; AI failure never touches Signal/Intervention data, Phase 2.7).
- [ ] AgentRun persistence (not yet wired to the `AgentRun` table — out of scope for Phase 2.7's advisory-only endpoint).
- [x] Assistant decision & intervention orchestration (deterministic surfacing rules, reuse-before-create idempotency, AI-derived interventions via the existing Intervention model, Phase 2.8A; see `docs/ASSISTANT_EVALUATION.md`).

## Phase 1.5
- [ ] Transparent Electron window.
- [ ] Character asset.
- [ ] Intervention card.
- [ ] Done action.
- [ ] Snooze action.
- [ ] SSE reconnect.
- [x] Open action for `open_source` interventions (desktop "Open" button + `shell.openExternal` IPC, http(s)-only; Done/Snooze lifecycle verified unchanged; Phase 2.8B; see `docs/ASSISTANT_EVALUATION.md`).

## Phase 1.6
- [ ] Unit tests.
- [ ] Integration tests.
- [ ] E2E smoke test.
- [ ] Clean install test.
- [ ] Demo recording.
- [ ] Only then start Phase 2.

## Phase 3.1 — Daily Context
- [x] `DailyAssistantContext` type — currentTime, upcomingEvents (24h), relevantEmails (24h), activeSignals, consolidatedSituations, goals; see `docs/DAILY_CONTEXT.md`.
- [x] Pure builder (`buildDailyContext`) applying the 24h windows on top of existing, unmodified repositories — no new Gmail/Calendar logic.
- [x] `GET /api/v1/context/daily` — read-only, creates no Signal/Intervention.

## Phase 3.2 — AI Prioritization (daily-context-aware)
- [x] `buildDailyContextPrioritizationInput` extends (not replaces) `buildPrioritizationInput` with `currentTime`/`upcomingEvents`/`relevantEmails`/`goals`.
- [x] Output `situationId` enum still built only from known situations — the model cannot reference the broader context fields as prioritizable targets.
- [x] Prompt bumped to v2 to describe the new fields; see `docs/AI_PRIORITIZATION.md`.

## Phase 3.3 — Proactive Assistant Behavior
- [x] Verified (not rewritten) — Phase 2.8A's `isEligibleToSurface`/reuse-before-create already satisfied every rule (high always surfaces, low always silent, medium only if relationship strong, completed/snoozed never resurfaced, idempotent, silence is valid); see `docs/PROACTIVE_ASSISTANT_BEHAVIOR.md`.
- [x] New tests: reuse never mutates a stored intervention on a changed AI opinion; idempotent across 3+ repeated evaluations.

## Phase 3.4 — Basic Goals & Commitments
- [x] `Goal` Prisma model (title/description/active only — no hierarchy, no progress tracking).
- [x] `POST /api/v1/goals`, `GET /api/v1/goals?includeInactive=`, `PATCH /api/v1/goals/:id`; see `docs/GOALS.md`.
- [x] Active goals wired into `DailyAssistantContext.goals` and the Groq prioritization input via the existing 3.1/3.2 pipeline — no separate goals pipeline.

## Phase 3 — Test infrastructure
- [x] Isolated test database — `apps/api/tests/setup.ts` requires `.env.test` and refuses to start if `DATABASE_URL` doesn't look like a test DB, after an earlier session accidentally wiped real dev data by running the suite against it. (Originally a separate Postgres database; now a separate SQLite file, `test.db` vs `dev.db` — see Phase 4.1.)

## Phase 4.1 — SQLite Migration (Windows-first standalone app track)
- [x] Prisma datasource switched from PostgreSQL to SQLite — no Docker/external DB process required to run the app; see `docs/SQLITE_MIGRATION.md`.
- [x] Array/Json/enum fields (unsupported by Prisma's SQLite connector) converted to JSON-encoded `String` columns, serialized/deserialized entirely inside the repositories — no change to any repository's public method signatures or to any route/service/domain logic.
- [x] Fixed a real correctness bug the migration would have silently introduced: `Intervention` priority ordering was relying on PostgreSQL enum sort order; now sorted in application code by explicit rank, verified via a real runtime smoke test.
- [x] Migration history reset (`p41_sqlite_init`) — old PostgreSQL SQL migrations aren't portable to SQLite.
- [x] Full test suite (464/464) passing against the new SQLite test database; typecheck/lint clean; real runtime smoke test (demo data, priority ordering, Done action, Goals, Daily Context) against the new SQLite dev database.

## Phase 4.2 — Single-Process Desktop Architecture
- [x] `apps/api` exports `buildApp` as a consumable library (`package.json` `main`/`exports`) — added as a workspace dependency of `apps/desktop`.
- [x] `startEmbeddedApiServer()` (`apps/desktop/src/main/api-server.ts`) starts the Fastify API inside Electron's main process on a dynamically assigned port (`listen({port: 0, ...})`), replacing the hardcoded `http://localhost:4000` / manually-started second terminal.
- [x] Dynamic `import()` (not static) of `@ai-agent/api`, deliberately, so an env-validation failure at module-load time is catchable and shown via a real error dialog instead of crashing Electron with an unhandled exception.
- [x] Graceful shutdown on `before-quit` — closes the embedded Fastify/Prisma server before the app actually exits.
- [x] `DESKTOP_API_URL` kept as an explicit opt-in escape hatch for pointing the desktop app at an already-running external API instance.
- [x] **Real (non-mocked) verification, not just typecheck**: built and launched actual Electron against the real dev SQLite database — confirmed the embedded server bound a genuine dynamic port, Prisma's native SQLite engine loaded and queried successfully inside Electron's process (the main open risk going into this phase), `GET /interventions` round-tripped real data end-to-end, and closing the window released the server and port cleanly. See `docs/SINGLE_PROCESS_DESKTOP.md`.
- [x] 4 new tests (`api-server.test.ts`); full desktop suite 18/19 (1 pre-existing, unrelated failure from Phase 2.1); typecheck/lint clean.

## Phase 4.3 — Onboarding & Settings UI
- [x] Settings screen (gear toggle) — Groq API key status/input/save, Google connection status/sign-in/disconnect; see `docs/ONBOARDING_SETTINGS.md`.
- [x] Two new `ApiClient` methods (`googleStatus`, `disconnectGoogle`) hitting the already-existing `/integrations/google/status|disconnect` routes — no new API routes needed.
- [x] Interim local key persistence (`app-config.ts`, plain JSON in `userData`) — explicitly temporary, upgraded to `safeStorage` in Phase 4.4.
- [x] Saving a new Groq key restarts the whole app (`app.relaunch()` + `app.exit()`) — the only correct way to make the embedded API's frozen env config pick up a change, given Node's ESM module-cache semantics; documented, not silently assumed to "just work."
- [x] Startup-error screen replaces Phase 4.2's native `dialog.showErrorBox` + `app.quit()` — the overlay window still opens, and the real error is shown in-app via `settings:get`.
- [x] Investigated PKCE / "Desktop app" OAuth client type (raised in the earlier discussion) — found Google still issues a client secret for that type, so no code change is actually required to register the existing client that way; full PKCE scoped out as a deliberate, documented future hardening step, not an oversight.
- [x] 5 new tests in `App.test.tsx` (settings open/close, startup error, Google status display, Groq key save) + 2 new `api-client.test.ts` tests + 4 new `app-config.test.ts` tests; full desktop suite 28/29 (1 pre-existing, unrelated failure); typecheck/lint clean; real Electron launch (twice) confirmed no crash and the live `/integrations/google/status` route responds correctly.

## Phase 4.4 — Secrets & Config Storage
- [x] `app-config.ts` upgraded from Phase 4.3's plain JSON to Electron's `safeStorage` (OS keychain — DPAPI/Keychain/libsecret) for both the Groq key and `ENCRYPTION_KEY`; `safeStorage` injected via a `SafeStorageLike` interface, not imported directly, so the module stays unit-testable without a running Electron instance. See `docs/SECRETS_STORAGE.md`.
- [x] `ENCRYPTION_KEY` auto-generated on first launch if not already present in the store or `.env` — removes the manual `openssl rand -base64 32` step for the desktop app. Precedence deliberately ordered (store → `.env` → generate) so an existing key is never silently replaced, which would make previously-encrypted Google refresh tokens undecryptable.
- [x] Backward-compatible with Phase 4.3's plaintext `config.json` — read once, auto-upgraded to the encrypted format on next save, no manual migration or data loss.
- [x] Honest fallback when `safeStorage.isEncryptionAvailable()` is false (e.g. some Linux setups with no keyring) — stores plain base64 instead of refusing to save, and the Settings screen shows an explicit warning rather than silently claiming encryption that isn't happening.
- [x] **Real (non-mocked) verification**: launched Electron twice against the real dev database — first launch created `config.json` with `"secure": true` and a genuinely non-readable encrypted value; second launch's file hash was byte-for-byte identical to the first, confirming the key isn't regenerated on every startup; both launches the embedded API started successfully and `GET /integrations/google/status` responded normally, confirming the generated key round-trips correctly through `crypto.ts`'s 32-byte validation.
- [x] 14 new tests in `app-config.test.ts` (encryption round-trip for both secrets, merge-on-save, legacy-file migration + re-save upgrade, decrypt-failure treated as unset not a crash, `secureStorageAvailable: false` fallback, key-generation format, `ensureEncryptionKey` idempotency) + 1 new `App.test.tsx` test (warning banner); full desktop suite 39/40 (1 pre-existing, unrelated failure); typecheck/lint clean.

## Phase 4.5 — Auto-Run Prisma Migrations on First Launch
- [x] `apps/desktop/src/main/migrate.ts`'s `runMigrations()` shells out to `prisma migrate deploy` (never `migrate dev` — no prompts, no shadow database) against `apps/api/prisma/schema.prisma` before the embedded API starts; safe to run unconditionally on every launch since it's a no-op once the schema is current. See `docs/AUTO_MIGRATIONS.md`.
- [x] `prisma` moved from a devDependency to a regular dependency of `apps/api` — the desktop app needs to resolve and run its CLI at runtime, not just during development.
- [x] A migration failure surfaces through the exact same in-app startup-error screen (Phase 4.3) as an embedded-API startup failure — no separate error UI needed.
- [x] **A real bug caught only by a genuine (non-mocked) Electron launch, not by unit tests**: `process.execPath` inside Electron's main process is `electron.exe`, not `node.exe` — spawning the prisma CLI with it (without `ELECTRON_RUN_AS_NODE=1`) silently tried to launch another Electron app instead of running the script, hanging with no window and no bound API port. Fixed by setting `ELECTRON_RUN_AS_NODE: "1"` on the spawned child's environment.
- [x] **Real (non-mocked) verification**: deleted the real `dev.db` to simulate a fresh install, ran the compiled migration function directly — confirmed a fresh SQLite file was created with all 9 expected tables via a direct Prisma Client query (not just "the file exists"), confirmed a second run is a clean no-op, restored the original `dev.db` with its demo data afterward. Separately, launched real Electron twice: the first attempt (before the `ELECTRON_RUN_AS_NODE` fix) hung with no window; after the fix, the embedded API bound a real dynamic port, `GET /health` and `GET /interventions` both responded, and the window had a genuine non-zero window handle — confirmed clean shutdown released the port.
- [x] 5 new tests in `migrate.test.ts` (CLI invocation shape including `ELECTRON_RUN_AS_NODE`, `DATABASE_URL` fallback chain, success incl. "no pending migrations", failure with captured output, spawn-failure); full desktop suite 44/45 (1 pre-existing, unrelated failure); typecheck/lint clean.

## Phase 4.6 — Windows Packaging via electron-builder
- [x] `apps/desktop/scripts/prepare-api-resources.mjs` builds a standalone, packaging-ready copy of `@ai-agent/api` at `resources/api/` — compiled JS + Prisma schema/migrations copied directly (no symlinks), `@ai-agent/shared`'s compiled output dropped straight into `node_modules` (workspace-only, not on the registry), and a plain `npm install --omit=dev` (deliberately not pnpm) for the registry-published runtime deps. See `docs/WINDOWS_PACKAGING.md`.
- [x] **A real, empirically-confirmed correctness problem this sidesteps**: pnpm workspace `node_modules` are symlink/junction trees into pnpm's shared store — copying them elsewhere (packaging) leaves dangling links. `pnpm deploy` doesn't fix this either: verified via `Get-Item | Select LinkType, Target` on a real `pnpm deploy` output that it uses its own internal virtual store with *absolute* Windows junctions, which break the same way once moved off the machine that ran the deploy.
- [x] New `api-location.ts`'s `resolveApiRoot({ isPackaged, resourcesPath })` — one resolver for both dev (`apps/api`, this monorepo's sibling) and packaged (`<resourcesPath>/api`) — computed once in `index.ts` and passed into both `runMigrations()` and `startEmbeddedApiServer()`, removing the dev-only assumptions each previously made internally.
- [x] `api-server.ts` refactored to import `<apiRoot>/dist/app.js` by absolute file URL instead of the bare `"@ai-agent/api"` package specifier — the bare specifier only resolves via node_modules (meaningless for a packaged app's standalone `resources/api`, unreachable through package resolution at all).
- [x] **A real electron-builder quirk caught only by inspecting actual packaged output, not the build log**: `extraResources` silently drops any `node_modules` directory it's asked to copy, even with an explicit `filter: ["**/*"]` override. Fixed with an `afterPack` hook (`scripts/after-pack.cjs`) that copies `resources/api/node_modules` into the packaged app after electron-builder finishes.
- [x] `apps/desktop/package.json` dependency cleanup: removed `@ai-agent/api` (no longer imported by specifier), moved `@ai-agent/shared`/`react`/`react-dom` to `devDependencies` (renderer-only, inlined by vite at build time) — the packaged app's own runtime now has exactly one real npm dependency, `dotenv`.
- [x] **Real (non-mocked) verification, five parts**: (1) inspected `prepare-api-resources.mjs`'s output directly, confirmed `@prisma/client` is a real directory via PowerShell, not a symlink; (2) ran the compiled `runMigrations()`/`startEmbeddedApiServer()` against `resources/api` directly under plain Node, before touching electron-builder at all; (3) launched the actual `--win dir` unpacked build twice — the first attempt (before the `afterPack` fix) would have crashed on a missing `@prisma/client`, caught specifically because the packaged exe was launched for real; after the fix, confirmed a fresh `dev.db` was created (migrations ran), the embedded API bound a real port and answered `GET /api/v1/health`, a real window existed, and closing it released the process/port; (4) reran the entire pipeline from `rm -rf release resources` and repeated the same launch verification — reproducible, not a one-off; (5) built the real NSIS installer (`AI Executive Agent Setup 0.1.0.exe`, ~151 MB) — not run, since installing software system-wide is a meaningfully more invasive action than a `--dir` build inspected in place.
- [x] New `api-location.test.ts` (2 tests) + `api-server.test.ts`/`migrate.test.ts` updated for the `apiRoot`-based signatures (12 tests total, all passing). Full desktop suite 47/48 (1 pre-existing, unrelated failure). Typecheck/lint clean — including a genuine fix (not just matching a pattern): added a `.cjs`-scoped eslint override for `@typescript-eslint/no-require-imports`, since both the new `after-pack.cjs` and the pre-existing `preload.cjs` legitimately need `require()`.
- [x] Not done this phase (left for Phase 4.7): no code signing certificate, no custom app icon, no clean-install validation on a machine that never had this repo's dev environment on it.

## Phase 4.7 — Clean-Install Validation (🟡 in progress)
- [x] Static DLL-dependency check on the native Prisma query engine and the main Electron `.exe` (via `grep -aoE "[A-Za-z0-9_.-]+\.dll"` over the raw binaries, no `dumpbin`/`objdump` available) — both reference only standard Windows system DLLs, no `VCRUNTIME140.dll`/`MSVCP140.dll`. Rules out the Visual C++ Redistributable as a clean-machine risk.
- [x] **Bug found via a real install, not a build log**: NSIS's installer runtime drops a top-level `resources/api/prisma/` folder (DB schema + migrations) from what it writes to `$INSTDIR`, even though the exact same bytes are verifiably present and byte-correct in the installer's own archive (confirmed via `7za l`/`7za x` — a raw extraction reproduces the files perfectly; only NSIS's own install step loses them). Fixed by keeping the schema at *two* locations: the conventional `resources/api/prisma/` (needed at build time by `@prisma/client`'s own `prisma generate` postinstall) and a nested `resources/api/dist/prisma/` copy (proven to survive installation), with `migrate.ts` preferring the former and falling back to the latter.
- [x] **Second bug, found via a 10-second direct script instead of a multi-minute install cycle**: `prepare-api-resources.mjs` placed `node_modules/@ai-agent/shared` *before* running `npm install`, which prunes anything under `node_modules/` not declared in `package.json` — silently losing it every run. Fixed by reordering the copy to happen *after* `npm install`.
- [x] **Third bug, a direct side effect of the first fix**: moving the schema *only* under `dist/prisma/` broke `@prisma/client`'s postinstall (`prisma generate`, which looks for `./prisma/schema.prisma` at the conventional path), leaving `node_modules/.prisma/client` unpopulated and the server throwing `@prisma/client did not initialize yet` on startup — resolved by keeping both schema copies (see above).
- [x] Honest documentation of observed installer flakiness under rapid repeated runs (see `docs/WINDOWS_PACKAGING.md`) — total extracted file counts varied across identical installer runs during this testing session, most likely real-time antivirus scanning racing with NSIS's extraction of several thousand small files (Windows Defender confirmed active), not a packaging defect; not chased further since a real user runs an installer once, not repeatedly for testing.
- [x] **Real (non-mocked) verification after the first three fixes**: clean install (directory + registry uninstall entry removed first), waited for actual extraction completion by polling installed file count (a single "process exited" check proved unreliable — see flakiness note above), confirmed both fixed paths present on disk, launched `AI Executive Agent.exe` from its real per-user install path (no elevation), confirmed the embedded API bound a real port and `GET /api/v1/health` responded `200`, confirmed clean shutdown released the process and port.
- [x] **Fourth bug — found by the user's own real install, not by anything checked from a terminal**: the app showed as running in Task Manager with **no window visible at all**. Root cause: `overlay-window.ts` resolved the renderer's `index.html` one directory level short (`dist/main/renderer/index.html`, nonexistent) instead of the real location (`dist/renderer/index.html`, a sibling of `dist/main/`) — confirmed via `npx asar list` on the packaged app. A failed `loadFile()` never fires `ready-to-show`, which the window's `.show()` was gated on, and the window was created with `show: false`, so it never appeared — a real process, genuinely no window, not a rendering glitch. Present since the overlay window was first written (Phase 1) and invisible to every dev-mode test since, because dev mode loads the Vite dev server URL directly and never touches this file-path code. Fixed with the correct two-levels-up path; verified without a screenshot by checking `MainWindowTitle` changed from Electron's fallback (`@ai-agent/desktop`) to the page's real `<title>AI Executive Agent Desktop</title>` — proof the renderer actually painted this time.
- [x] New `overlay-window.test.ts` (2 tests, mocking `electron`) asserting the resolved path ends in `/renderer/index.html` and never contains `/main/renderer/` — the only thing in the suite now capable of catching this regression, since dev-mode testing structurally can't reach this code path.
- [x] Full desktop suite 49/50 (1 pre-existing, unrelated failure) after all four fixes; typecheck/lint clean.

## Phase 4.7 continued — Onboarding, Manual Sync, Real Google OAuth (🟡 core loop verified, clean-machine test still open)

Full detail in `docs/ONBOARDING_AND_MANUAL_SYNC.md`. The user's own first
real click-through (the actual point of Phase 4.7) found the app
completely unusable end-to-end — this section is everything that took to
fix, plus the feature the user actually asked to test.

- [x] **Bug 5**: the overlay was click-through in every screen except "has an intervention" — `setInteractive` was never wired to Settings/onboarding/empty-state. Fixed by making the window interactive unconditionally on mount, since every screen now has real clickable content. New `App.test.tsx` "window interactivity" tests.
- [x] **Bug 6**: `DATABASE_URL` was never set for the packaged app's own main process, only the separate migration child process — invisible until the embedded server's first real Prisma query (the new `ensureDemoUser` bootstrap below). Fixed with an absolute, `userData`-rooted path set before anything needs it.
- [x] **Bug 7**: `Character.tsx`'s `src="/character.svg"` (absolute) couldn't be reached by the earlier `vite.config.ts` `base: "./"` fix, which only rewrites Vite-generated asset paths, not hand-written JSX strings. Fixed with a relative path; verified via CDP that the image genuinely loads (`naturalWidth=1024`), not just "path looks right." Also fixed the `alt` text — closes a "pre-existing, unrelated" failing test that had been flagged since Phase 2.1; full desktop suite is genuinely all-green for the first time. New `Character.test.tsx`.
- [x] **Real architectural gap closed**: this app is single-user, and every route (including "Connect Google" itself) needs one bootstrap `User` row that used to only get created by a manual seed script nobody runs in the packaged app. New `ensureDemoUser`, run idempotently on every API start via a Fastify `onReady` hook. New `tests/demo-user-bootstrap.api.test.ts` (3 tests, `apps/api`).
- [x] **Feature: real first-run onboarding screen** — `Settings.tsx`'s `onClose` prop is now optional; absent, it renders as a "Get started" screen (Groq key + Google credentials + connect, shown automatically) instead of the old one-line "No pending interventions" text. New `use-setup-status.ts` polls setup completion on the same 15s cadence as intervention polling, since Google sign-in happens in the system browser with no push-back signal.
- [x] **Feature: manual "Check now"** — `ApiClient.checkNow()` runs Gmail sync → detect-signals → Calendar sync → detect-signals → evaluate sequentially, the manual stand-in for not-yet-built automatic polling. New IPC (`assistant:check-now`), new `api-client.test.ts` tests (call order, fail-fast on any step).
- [x] **Feature: multiple pending interventions, one at a time** — `useInterventionPolling` now exposes the full list (was `items[0]` only); `App.tsx` pages through it with `‹ N of M ›` controls, per an explicit choice over "stacked list" made with the user given the overlay's small fixed footprint.
- [x] **Real product decision, not a bug — Google OAuth from a packaged install**: two separate fixes needed. (1) `api-server.ts`'s port is now fixed at 4000 (was dynamic), because the project's existing, already-real-world-tested Google OAuth client's registered redirect URI needs an exact match — a random port every launch could never match. (2) New Settings fields for Google Client ID/Secret, safeStorage-encrypted, deliberately **never baked into source** even though working credentials already exist — this client looks like a "Web application"-type registration (Google treats that secret as genuinely confidential, unlike a "Desktop app"-type client's secret, which Google's own model expects to ship inside distributed apps).
- [x] **Real (agent-verified) confirmation before handing to the user**: a direct diagnostic script with fake credentials confirmed `/connect` returns a real `302` to `accounts.google.com` with correct `client_id`/`redirect_uri` params, replacing the previous `"not configured"` `400`.
- [x] **Real (user-verified, not agent-simulated) end-to-end confirmation**: the user completed the full cycle with their own real Google account on the actual packaged installer — fresh install → Groq key + Google credentials saved → real Google sign-in completed → "Check now" → a real calendar event came back as a correctly-styled `MEDIUM`-priority intervention, character visible, all action buttons present. Confirmed via screenshot.
- [x] **An open question, honestly unresolved**: partway through, the database was found completely empty (bootstrap user only) despite an earlier successful connection — the user repeated the flow and it worked again, but the root cause of that apparent data loss was never identified. See `docs/ONBOARDING_AND_MANUAL_SYNC.md`'s "open question" section for what was and wasn't ruled out.
- [x] Full desktop suite: 65/65 (genuinely all green). Full `apps/api` suite: 467/467 (one pre-existing, documented flake under full-suite load in `assistant-evaluate.api.test.ts` — a hook timeout, known intermittent since Phase 2.7 — passes cleanly every time run standalone). Typecheck/lint clean across both.
- [ ] **Not done — carried forward**: the actual point of Phase 4.7 (a genuinely clean machine — everything above was still on the same dev machine); continuous/scheduled sync (the user's own explicit next step); the unresolved data-loss episode; Done/Snooze/Open not yet click-tested by the user against real data; Google disconnect/reconnect not exercised; no systematic audit for other hand-written absolute asset paths in the renderer; no code signing certificate, no custom app icon.
