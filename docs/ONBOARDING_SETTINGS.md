# Onboarding & Settings UI (Phase 4.3)

A real in-app Settings screen — Groq API key entry, Google sign-in/status —
plus a proper startup-error screen instead of a native crash dialog. Third
step of the Windows-first standalone-app track.

## What's in the Settings screen

Opened via a small gear button (⚙, top-left of the overlay, always
visible):

- **Groq API key**: shows "Configured" / "Not configured", a password-style
  input, and a Save button. Saving persists the key and **restarts the
  whole app** — see "Why saving restarts the app" below.
- **Google account**: shows connection status (and email, if connected),
  with a "Sign in with Google" button (reuses the existing
  `integrations:connect-google` IPC flow — opens the system browser to
  `/integrations/google/connect`, unchanged from Phase 1) or a
  "Disconnect" button, backed by two new `ApiClient` methods
  (`googleStatus()`, `disconnectGoogle()`) hitting the already-existing
  `GET/POST /api/v1/integrations/google/status|disconnect` routes — no new
  API routes were needed.

## Why saving the Groq key restarts the app

The embedded API (Phase 4.2) is loaded via a dynamic `import("@ai-agent/api")`
inside Electron's main process. Node's ESM loader caches a module by
specifier — a second `import()` of the same package returns the **same**
already-evaluated module, not a fresh one. `@ai-agent/api`'s `GROQ_API_KEY`
is read once, at that first import, into a frozen `env` object
(`config/env.ts`). There is no supported way to make the already-running
embedded server pick up a changed key without either a much larger
refactor (making every env access dynamic, touching Phase 2/3 code broadly)
or actually reloading the process.

The chosen approach: `saveGroqKeyAndRestart` (in `index.ts`) persists the
key via `app-config.ts`, then calls `app.relaunch()` followed by
`app.exit(0)` — the whole Electron process restarts, the new key is picked
up from `.env`-style config-seeding logic in `index.ts` before the embedded
API's first import happens, same as any other env var. Simple, correct,
and honest — the Settings UI itself says "Save (restarts the app)" rather
than implying a silent live update that isn't actually possible.

## Where the key is stored

**Update (Phase 4.4):** `apps/desktop/src/main/app-config.ts` originally
wrote a plain JSON file here — deliberately temporary, flagged at the time
as not meaningfully more secure than `.env`. Phase 4.4 replaced that with
Electron's `safeStorage` API (OS keychain-backed encryption); see
`docs/SECRETS_STORAGE.md` for the details. This section is left as a
historical record of the Phase 4.3 scoping decision.

A saved key takes precedence over whatever's in `.env` — `index.ts` sets
`process.env.GROQ_API_KEY` from the saved config (if present) before the
embedded API's env validation runs.

## The startup error screen

Phase 4.2 handled an embedded-API startup failure with `dialog.showErrorBox`
+ `app.quit()` — a native, unstyled crash-looking dialog. This phase
replaces that: on failure, the overlay window is still created, and the
error is exposed to the renderer via the `settings:get` IPC call
(`{ groqKeyConfigured, startupError }`) rather than a native dialog. The
renderer shows a dedicated `startup-error-card` with the actual error
message instead of a blank overlay or a scary crash box.

Realistically, this only fires for `DATABASE_URL`/`ENCRYPTION_KEY`-class
problems — `GROQ_API_KEY`/Google credentials are optional in `env.ts`'s
schema, so a missing Groq key never fails startup; it just means
prioritization calls fail later with a clear `not_configured` error (Phase
2.7 behavior, unchanged).

## Explicitly out of scope for this phase (deliberate, not an oversight)

- **PKCE / "Desktop app" OAuth client type.** The earlier discussion this
  session raised switching Google's OAuth client type and adding PKCE as a
  security hardening step. On investigation: Google still issues a client
  secret for "Desktop app" type clients (it's not actually secret-less),
  so registering the existing OAuth client as that type requires **zero**
  code changes — the current `authorization_code` + client secret flow
  keeps working unmodified. Full PKCE (code_verifier/code_challenge) is a
  genuine, separate protocol change to `google-oauth.service.ts`'s
  connect/callback routes, additive security hardening rather than
  something blocking this phase's UI goals. Not implemented here; a
  candidate for a future security-hardening pass, not silently dropped.
- **`safeStorage`-backed secrets** — Phase 4.4, as above.
- **Auto-migration on first launch** — Phase 4.5, unchanged.
- **Google Client ID/Secret entry in the UI** — deliberately never added;
  per the earlier discussion, those are per-application credentials meant
  to be baked into the shipped app (a packaging-phase concern), not
  something an end user should ever see or type.

## Real verification performed

- Full desktop test suite: **28/29 passing** (5 new tests for Settings/
  startup-error behavior, all passing; the 1 failure is the pre-existing,
  unrelated Phase 2.1 alt-text mismatch).
- `pnpm -r typecheck` / lint clean.
- **Real (non-mocked) Electron launch**, twice — confirmed the app starts
  without crashing with the new `app-config.ts` loading and the four new
  IPC handlers registered, confirmed `GET /integrations/google/status`
  (the exact route the Settings screen calls) responds correctly against
  the live embedded server, confirmed clean shutdown released the port.
- **Not verified**: actually clicking through the Settings UI in the live
  Electron window (opening it, typing a key, clicking Save, watching the
  app restart, or clicking "Sign in with Google" and completing a live
  OAuth round-trip) — there's no way to drive the native window's GUI from
  this environment. The renderer-level behavior (toggle, form state, calls
  made to the bridge) is covered by the automated tests instead, which
  faithfully mock the exact bridge surface `preload.ts` exposes. This is
  the user's own manual validation step, not yet performed.

## Code

| Concern | File |
|---|---|
| Local key persistence (now `safeStorage`-backed — Phase 4.4) | `apps/desktop/src/main/app-config.ts` |
| Settings/startup IPC handlers | `apps/desktop/src/main/ipc/register-ipc.ts` |
| App bootstrap (config seeding, restart wiring) | `apps/desktop/src/main/index.ts` |
| New `ApiClient` methods | `apps/desktop/src/main/api-client.ts` |
| Settings UI | `apps/desktop/src/renderer/components/Settings.tsx` |
| Startup error / settings toggle wiring | `apps/desktop/src/renderer/App.tsx` |
