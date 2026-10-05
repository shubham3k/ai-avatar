# ADR-007: A macOS build of Zara (Phase 1 — unsigned, built on GitHub Actions)

**Status:** Accepted (Oct 5, 2026 — user said "proceed with phase 1")
**Branch:** `mac-build` (from `zara-agent` at `1724651`; `zara-agent` itself isn't merged into `main` yet)

## Context

Zara (ADR-006) ships as a Windows installer built on the user's PC. The user wants a Mac version. Electron, the embedded Fastify API, SQLite/Prisma, onnxruntime-node and the MCP SDK are all cross-platform, but:

- A Mac app must be **built on macOS**: the packaged API's native parts (Prisma engines, onnxruntime-node, sharp) are installed for the build machine's OS/CPU by `prepare-api-resources.mjs`'s `npm install`, and Apple's signing tools only exist on macOS. The user has no Mac to build on.
- A few features are Windows-specific: the busy/presentation/call detector (a PowerShell helper), the hotkey rules (Windows-reserved combos), the tray (Windows click conventions), Windows-voice wording, and `npx` connections (a Mac app started from Finder gets a minimal PATH without Homebrew/nvm, so `npx` isn't found).

## Decision

1. **Build on GitHub Actions** (`.github/workflows/build-mac.yml`), started by hand (`workflow_dispatch`): `macos-14` (Apple Silicon, arm64) and `macos-13` (Intel, x64) build separately — each runner's own `npm install` fetches the right native binaries; no universal binary. The workflow runs typecheck + tests first and uploads the `.dmg` as a downloadable artifact. No secrets are needed (keys stay in the app's Settings on each computer).
2. **Phase 1 is unsigned**: ad-hoc signing only (`mac.identity: "-"`), so Apple Silicon will run it after the user allows it once (right-click → Open, or `xattr -cr`). Developer ID signing + notarization come later, once the user has an Apple Developer account (certificates as GitHub Secrets).
3. **Packaging:** electron-builder `mac` target (`dmg`), hardened runtime with the standard Electron entitlements (JIT, unsigned executable memory, library validation off — the packaged API loads native modules, and child processes run Electron as Node), `NSMicrophoneUsageDescription`, `LSUIElement` (menu-bar app, no Dock icon). `after-pack.cjs` copies the API into `<App>.app/Contents/Resources/api` on macOS.
4. **Mac behaviour:**
   - **Hotkey** default `Cmd+Shift+Space`; Cmd/Ctrl/Option allowed; Spotlight / input-source / emoji / app-switcher / quit / hide / screenshot combos refused. Windows keeps `Ctrl+Shift+Space` and its rules unchanged.
   - **Menu-bar icon** (template image, so it follows light/dark menu bars); the menu opens on click as macOS expects.
   - **Overlay** stays visible on every Space and over full-screen apps.
   - **Microphone**: the app asks macOS for permission (`systemPreferences.askForMediaAccess`) before the first recording.
   - **PATH fix** at startup on macOS: adds Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`), Volta, and the newest nvm Node to `PATH`, so `npx` connections and the API find Node.
   - **Holding pop-ups during calls/presentations is off on Mac** for now (pop-ups always show; quiet hours still work); Settings → Proactive says so. A Mac detector is a later phase.
   - Wording: "Windows voice" → "Mac voice" on macOS; the system voices come from macOS (incl. the Hindi voice Lekha).
5. **Windows is unchanged** — every Mac difference is behind `process.platform === "darwin"`, with the platform injected in tests.

## Consequences

- The user tests on a Mac they borrow/own; GitHub only builds. Phase 1 can't be verified on the Windows dev PC beyond unit tests.
- Private repos spend GitHub's Mac minutes at 10× (≈ 200 free Mac minutes/month); a run builds two variants (~15–20 min each).
- Later: Developer ID signing + notarization, a Mac busy detector (full-screen / Zoom / Teams / Meet using mic or camera), an app icon, optional automatic releases on tags.
