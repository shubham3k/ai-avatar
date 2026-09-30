# Current Status - Quick Reference

**Last Updated**: September 29, 2026
**🧠 Zara (ADR-006) in progress on branch `zara-agent`:** M0–M7 ✅ in source. M7: Zara drafts email and proposes calendar create/move/cancel as **approval cards** (Approve / Edit / Cancel; email needs a click, then 30 s with Undo; first-time recipients flagged; own-only calendar changes can be approved in chat); new Google permissions gmail.send / calendar.events / drive.readonly (reconnect via Settings → Actions); writing style + learning from edits; every action logged with Undo where possible. M3–M7 not yet user-tested. **Next: M8 MCP connections**, then M9 routines. Full detail: HANDOFF.md top section + newest addenda; design: `docs/decisions/ADR-006-zara-personal-agent.md`.
**Git:** `main` = checkpoint `3a96d64` (everything up to Sept 28). `zara-agent` = M0 `d96f08a` → M1 `ca77fc2` → M2 `94e6181` → M3 `03b4efa` → M4 voice `30d7394` → M5 proactive `0e51869` → test-feedback fixes `6c6271b` → M6 recall `f1c6cf5` → M7 actions (see `git log`). Nothing pushed. Merge `zara-agent` → `main` when Zara is complete.
**Running it:** dev mode — `pnpm --filter @ai-agent/shared build` → `pnpm --filter @ai-agent/api build` → `pnpm --filter @ai-agent/desktop electron:dev` (quit the installed app first; port 4000). The installed `.exe` (Sept 28, 15:17) predates M1–M7; rebuild only when the user asks.
**Keys:** OpenAI key in the app's Settings → General (encrypted, shared by dev and installed app); Groq optional backup. Real OpenAI chat not yet verified (no OpenAI key in `apps/api/.env`; agent live tests ran over Groq).
**Tests at last run:** API 718/718, desktop 248/248, workspace typecheck + lint clean. Known flake: `tests/assistant-evaluate.api.test.ts` hook timeout under full-suite load — passes standalone.

---

## ✅ What's Working Right Now

### Database (Phase 4.1 — SQLite, no Docker required)
- Embedded SQLite file (`apps/api/prisma/dev.db`), created automatically by `pnpm db:migrate` — or, since Phase 4.5, automatically by Electron itself on launch (`prisma migrate deploy`), no manual step required
- All tables created and migrated
- 4 demo interventions loaded
- Demo user: `demo@example.local`
- See [docs/SQLITE_MIGRATION.md](./docs/SQLITE_MIGRATION.md) for what changed from the previous PostgreSQL setup

### API (port 4000)
- Health endpoint: `/api/v1/health`
- Interventions: `/api/v1/interventions`
- Done action: `POST /api/v1/interventions/:id/done`
- Snooze action: `POST /api/v1/interventions/:id/snooze`

### Desktop App
- Electron overlay window
- **First-run "Get started" screen (Phase 4.7)**: shown automatically whenever the Groq key or Google connection is missing — no gear-icon detour needed. Groq key input + Save, Google OAuth Client ID/Secret input + Save, "Sign in with Google" (disabled until credentials are set). Flips to the normal view automatically within 15s of finishing setup (polled, since Google sign-in happens in the system browser).
- **Manual "Check now" (Phase 4.7)**: runs Gmail sync → detect-signals → Calendar sync → detect-signals → AI evaluation on demand — the stand-in for not-yet-built automatic polling. Shown prominently when there's nothing pending, and as a small corner link once there is.
- **Multiple pending interventions, one at a time (Phase 4.7)**: `‹ 2 of 3 ›`-style paging instead of only ever showing the single highest-priority item.
- Done/Remind Later/Open buttons working
- Transparent, bottom-right positioned, now genuinely clickable in every state (was click-through except when an intervention card was showing — Phase 4.7 bug)
- **Single process (Phase 4.2, port fixed in Phase 4.7)**: the API starts inside Electron's main process on a **fixed** port 4000 (was dynamic — changed because Google OAuth's registered redirect URI needs an exact, unchanging match). See [docs/SINGLE_PROCESS_DESKTOP.md](./docs/SINGLE_PROCESS_DESKTOP.md).
- **Settings screen (Phase 4.3, extended in Phase 4.7)**: gear button opens an in-app Settings panel — Groq API key entry, Google OAuth Client ID/Secret entry (new), Google sign-in/status/disconnect (saving either key restarts the app). Startup failures now show an in-app error card instead of a native crash dialog. See [docs/ONBOARDING_SETTINGS.md](./docs/ONBOARDING_SETTINGS.md) and [docs/ONBOARDING_AND_MANUAL_SYNC.md](./docs/ONBOARDING_AND_MANUAL_SYNC.md).
- **Encrypted secrets storage (Phase 4.4, extended in Phase 4.7)**: the Groq key, `ENCRYPTION_KEY`, and (new) Google OAuth Client ID/Secret are all stored via Electron's `safeStorage` (OS keychain-backed), not plain text, and never baked into source/the distributed binary. `ENCRYPTION_KEY` is auto-generated on first launch if nothing else provides one. See [docs/SECRETS_STORAGE.md](./docs/SECRETS_STORAGE.md).
- **Auto-run database migrations (Phase 4.5)**: Electron runs `prisma migrate deploy` itself before starting the embedded API — no more manual `pnpm db:migrate` step on a fresh clone/install. See [docs/AUTO_MIGRATIONS.md](./docs/AUTO_MIGRATIONS.md).
- **Windows packaging (Phase 4.6)**: `npm run package:win` (from `apps/desktop`) builds a real standalone installer (`AI Executive Agent Setup <version>.exe`, NSIS) plus an unpacked `release/win-unpacked/` build — no monorepo, pnpm, or dev server needed to run it. See [docs/WINDOWS_PACKAGING.md](./docs/WINDOWS_PACKAGING.md).
- **Single-user bootstrap (Phase 4.7)**: the one demo user every route needs is now auto-created on every API start (was a manual seed script, never run by the packaged app — "Connect Google" itself failed without it on a truly fresh install).

### Google OAuth (Phase 2.1)
- `/api/v1/integrations/google/connect|callback|status|disconnect`
- Refresh/access tokens encrypted at rest (AES-256-GCM)
- Read-only Gmail + Calendar scopes requested
- See [docs/GOOGLE_OAUTH.md](./docs/GOOGLE_OAUTH.md) for setup

### Gmail Read-Only Access (Phase 2.2A)
- `GET /api/v1/integrations/google/gmail/messages?limit=` (default 10, max 25)
- Uses the existing Google connection; no separate OAuth flow
- Returns normalized `{id, threadId, subject, from, to, date, snippet, labels}`

### Gmail Persistence & Sync (Phase 2.2B)
- `POST /api/v1/integrations/google/gmail/sync?limit=` — idempotent upsert into `Email`
- `GET /api/v1/integrations/google/gmail/stored-messages?limit=` — reads local DB only
- Returns `{fetched, created, updated}`; never returns email contents
- No email bodies, no background/scheduled sync

### Actionable Email Signals (Phase 2.3)
- `POST /api/v1/integrations/google/gmail/detect-signals?limit=` — deterministic, no AI
- Reuses the existing Phase 1 Signal/Intervention pipeline as-is
- Idempotent (existing `Signal`/`Intervention` unique constraints)
- Generated interventions surface through the existing desktop polling/Done/Snooze
- See [docs/GMAIL_SIGNALS.md](./docs/GMAIL_SIGNALS.md) for the exact rules

### Calendar Read-Only Access (Phase 2.4A)
- `GET /api/v1/integrations/google/calendar/events?limit=` (default 10, max 25)
- Uses the existing Google connection; no separate OAuth flow
- Primary calendar, upcoming events only, cancelled events excluded

### Calendar Persistence & Sync (Phase 2.4B)
- `POST /api/v1/integrations/google/calendar/sync?limit=` — idempotent upsert into `CalendarEvent`
- `GET /api/v1/integrations/google/calendar/stored-events?limit=` — reads local DB only
- Returns `{fetched, created, updated}`; timed and all-day events both handled
- No writes, no background/scheduled sync
- See [docs/GOOGLE_CALENDAR.md](./docs/GOOGLE_CALENDAR.md) for details

### Calendar Signal Detection (Phase 2.5)
- `POST /api/v1/integrations/google/calendar/detect-signals?limit=` — deterministic, no AI
- Upcoming-meeting rule: actionable within 30 min, high priority within 10 min
- Reuses the existing Signal/Intervention pipeline (same as Gmail signals)
- All-day events explicitly excluded; attendee count never affects the decision
- See [docs/CALENDAR_SIGNALS.md](./docs/CALENDAR_SIGNALS.md) for the exact rules

### Cross-Source Context (Phase 2.6A)
- `GET /api/v1/context/cross-source` — deterministic, no AI, read-only
- Correlates recent emails (14 days) with upcoming events (7 days)
- `attendee_match` (strong) or `topic_overlap` (possible); `[]` is normal/expected
- No persistence, no signals, no interventions created
- See [docs/CROSS_SOURCE_CONTEXT.md](./docs/CROSS_SOURCE_CONTEXT.md) for the exact rules

### Consolidated Situations (Phase 2.6B)
- `GET /api/v1/context/situations` — deterministic, no AI, read-only
- Groups an email signal + calendar signal into one situation when Phase 2.6A links them
- Deterministic primary-signal rule: confidence → dueAt → createdAt
- No new signals, no interventions, no persistence, no new signal type
- See [docs/CONSOLIDATED_SITUATIONS.md](./docs/CONSOLIDATED_SITUATIONS.md) for the exact rules

### AI Prioritization (Phase 2.7)
- `GET /api/v1/prioritization` — advisory only, read-only, first LLM layer
- Ranks existing consolidated situations via Groq's Chat Completions API (structured output; swapped from OpenAI during Phase 2 manual validation — see HANDOFF.md)
- Cannot create signals/interventions, read Gmail/Calendar, or take any action
- Requires `GROQ_API_KEY`; skips the AI call entirely when there are no situations
- See [docs/AI_PRIORITIZATION.md](./docs/AI_PRIORITIZATION.md) for input/output/failure details

### Assistant Decision & Intervention Orchestration (Phase 2.8A)
- `POST /api/v1/assistant/evaluate` — first endpoint allowed to create `Intervention` rows from AI output
- Deterministic surfacing: high always eligible, medium only if relationship is "strong", low never
- Reuse-before-create across every signal in a situation — idempotent, no duplicate interventions
- Action URL always from stored Email/CalendarEvent data, never from the AI
- Desktop unchanged — new interventions surface via the existing `/interventions` polling
- See [docs/ASSISTANT_EVALUATION.md](./docs/ASSISTANT_EVALUATION.md) for the exact rules

### Assistant Behavior & Intervention Lifecycle (Phase 2.8B)
- Desktop "Open" button for `open_source` interventions (was missing until this phase)
- Opens the stored `sourceUrl` via `shell.openExternal`, restricted to http(s) only
- Existing Done/Snooze/polling/idempotency behavior verified unchanged
- See [docs/ASSISTANT_EVALUATION.md](./docs/ASSISTANT_EVALUATION.md) and `HANDOFF.md`'s Phase 2.8B addendum

### Daily Context (Phase 3.1)
- `GET /api/v1/context/daily` — read-only, bounded snapshot: current time, upcoming events (24h), relevant emails (24h), active signals, consolidated situations, active goals
- Built entirely from existing Phase 2 repositories/services — no new Gmail/Calendar logic
- See [docs/DAILY_CONTEXT.md](./docs/DAILY_CONTEXT.md)

### Daily-Context-Aware AI Prioritization (Phase 3.2)
- `GET /api/v1/prioritization` (and `POST /api/v1/assistant/evaluate`) now sends Phase 3.1's daily context fields to Groq alongside the unchanged per-situation detail
- Output `situationId` enum is still built only from known situations — the model cannot reference `upcomingEvents`/`relevantEmails`/`goals` as if they were prioritizable
- See [docs/AI_PRIORITIZATION.md](./docs/AI_PRIORITIZATION.md)'s Phase 3.2 section

### Proactive Assistant Behavior (Phase 3.3)
- Verified (not rewritten) — Phase 2.8A's deterministic surfacing/reuse rules already satisfied every Phase 3.3 requirement
- New tests lock down: reuse never mutates a stored intervention's priority/message, and repeated evaluation stays idempotent across 3+ calls
- See [docs/PROACTIVE_ASSISTANT_BEHAVIOR.md](./docs/PROACTIVE_ASSISTANT_BEHAVIOR.md)

### Basic Goals & Commitments (Phase 3.4)
- `POST /api/v1/goals`, `GET /api/v1/goals?includeInactive=`, `PATCH /api/v1/goals/:id` — title/description/active only, no hierarchy or progress tracking
- Active goals flow into `GET /context/daily` and the Groq prioritization input automatically via the existing Phase 3.1/3.2 pipeline
- See [docs/GOALS.md](./docs/GOALS.md)

### Background sync, tray, pause, reminders + voice (Sept 18–24, 2026 — not yet committed/packaged)
- **Background sync**: runs automatically every 15 min (`DESKTOP_SYNC_INTERVAL_MINUTES`), no more manual "Check now" required, though it still works
- **System tray icon**: Check now / Pause notifications (30min–4hr) / Quit — the only way to close the app before this existed was Task Manager
- **Google auth-expiry detection**: a red-dot badge on the settings gear + "Reconnect Google" flow when a sync call comes back 401/403
- **Reminders** — `POST /api/v1/reminders` (exact time), `/reminders/from-text` (free text parsed by Groq, fires *before* the deadline it mentions, not at it), `/reminders/from-voice` (recorded clip → Groq Whisper → same text-parsing path); `GET`/`DELETE /reminders` also exist. Surfaces through the existing intervention pipeline — no new UI paradigm
- **Voice**: 🎤 button in Settings, records via the browser's own `MediaRecorder`, transcribes and schedules in one round trip
- **Window auto-sizing + two real bug fixes**: the window now sizes to actual content instead of a fixed 380×540; Settings is now internally scrollable (was silently clipping the bottom of the page on shorter displays); the empty/idle state no longer shows a persistent "All caught up" box — just small corner text
- **Broadened email detection**: every new unread email is now surfaced (previously only specific keyword phrases were)
- Full detail, verification notes, and what's still open: **HANDOFF.md's most recent addendum** — read that before doing anything else in this area

---

## 🚀 Quick Start

**Phase 4.2: no separate API terminal anymore** — the API starts inside
Electron's main process automatically. But since Phase 4.2, `apps/desktop`
imports `@ai-agent/api` as a **compiled** workspace dependency — after
pulling new code (or changing anything in `apps/api/src`), rebuild both
before testing in Electron, or you'll be running stale code silently:

```powershell
# Rebuild the API (desktop imports its compiled dist/, not live source)
cd apps/api
npx tsc -p tsconfig.json

# Rebuild the desktop main process + copy preload
cd apps/desktop
npx tsc -p tsconfig.json
node scripts/copy-preload.mjs
```

Then:

```powershell
# Terminal 1 — Vite dev server for the renderer (React UI)
cd apps/desktop
pnpm dev

# Terminal 2 — Electron (after Vite is ready); starts the embedded API itself
cd apps/desktop
npx electron .
```

(`pnpm electron:dev` also works and does both in one command, but running
them separately in two terminals — as above — has been the more reliable
path in practice on this machine.)

To run the API standalone instead (e.g. to hit it with `curl` without
opening Electron), `cd apps/api && pnpm dev` still works exactly as
before — it's just no longer required for the desktop app to function.

**Before starting Electron, always check nothing is already listening**
(a leftover process from a previous session/test run is the most common
cause of confusing "nothing happened" or stale-behavior bugs on this
machine):
```powershell
Get-NetTCPConnection -LocalPort 4000,5173 -State Listen -ErrorAction SilentlyContinue
```
If that returns anything, stop it (`Stop-Process -Id <OwningProcess> -Force`)
before launching again.

---

## ⚠️ Common Issues

### Database Auth Fails
```powershell
# Fix .env line endings
$content = Get-Content ".env" -Raw; $content -replace "`r`n", "`n" | Set-Content ".env" -NoNewline
```

### "Desktop bridge unavailable"
- You're viewing in browser, not Electron
- Run via `pnpm electron` command

### Port Already in Use
Since Phase 4.7, this matters for the **packaged desktop app too**, not
just `apps/api` run standalone — the embedded API's port is fixed at 4000
(was dynamic; changed for Google OAuth compatibility, see
`docs/ONBOARDING_AND_MANUAL_SYNC.md`). If port 4000 is already taken when
the desktop app launches, it'll fail to start with an in-app error card.
```powershell
# Precise — only the process actually holding the port (don't blanket-kill
# all node processes, that can also kill an unrelated Claude Code session
# or other local projects)
$owner = (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($owner) { Stop-Process -Id $owner -Force }
```

### Stale `DATABASE_URL` (or other) environment variable shadowing `.env`
Node's `dotenv` never overrides a variable already set in the shell/user
environment. If the API behaves as if `.env` is being ignored (wrong DB,
wrong port, etc.), check for a leftover **User-level** Windows env var
before assuming the code is broken — this cost significant time earlier in
this project's history:
```powershell
[Environment]::GetEnvironmentVariable('DATABASE_URL','User')
```
If that prints anything, clear it and open a **genuinely new** terminal
window (not a new tab in an already-running host — those can inherit the
stale value):
```powershell
[Environment]::SetEnvironmentVariable('DATABASE_URL', $null, 'User')
```

---

## 📚 Documentation

- **[HANDOFF.md](./HANDOFF.md)** - Complete project history and next steps
- **[README.md](./README.md)** - Setup and installation guide
- **[apps/api/README.md](./apps/api/README.md)** - API documentation
- **[apps/desktop/README.md](./apps/desktop/README.md)** - Desktop app guide

---

## 🎯 Next Phase Tasks

1. ~~Google OAuth integration~~ ✅ Done (Phase 2.1)
2. ~~Gmail read-only access~~ ✅ Done (Phase 2.2A)
3. ~~Email persistence + sync~~ ✅ Done (Phase 2.2B)
4. ~~Actionable email signal detection~~ ✅ Done (Phase 2.3)
5. ~~Google Calendar connector (read-only + persistence/sync)~~ ✅ Done (Phase 2.4A/2.4B)
6. ~~Calendar signal detection~~ ✅ Done (Phase 2.5)
7. ~~Gmail + Calendar cross-source context~~ ✅ Done (Phase 2.6A)
8. ~~Context-aware signal consolidation~~ ✅ Done (Phase 2.6B)
9. ~~LLM prioritization using consolidated situations~~ ✅ Done (Phase 2.7)
10. ~~Assistant decision & intervention orchestration~~ ✅ Done (Phase 2.8A)
11. ~~Assistant behavior & intervention lifecycle (Open action)~~ ✅ Done (Phase 2.8B)
12. ~~Daily context~~ ✅ Done (Phase 3.1)
13. ~~Daily-context-aware AI prioritization~~ ✅ Done (Phase 3.2)
14. ~~Proactive assistant behavior~~ ✅ Done (Phase 3.3)
15. ~~Basic goals & commitments~~ ✅ Done (Phase 3.4)
16. ~~SQLite migration~~ ✅ Done (Phase 4.1) — Windows-first standalone app track
17. ~~Single-process architecture~~ ✅ Done (Phase 4.2, port fixed to 4000 in Phase 4.7 for Google OAuth) — API runs inside Electron's main process
18. ~~Onboarding & settings UI~~ ✅ Done (Phase 4.3, redesigned in Phase 4.7) — real "Get started" screen shown automatically, not just a gear-icon panel
19. ~~Secrets/config storage via `safeStorage`~~ ✅ Done (Phase 4.4, extended in Phase 4.7) — Groq key + Google OAuth Client ID/Secret + auto-generated `ENCRYPTION_KEY`, OS-keychain-encrypted, never in source
20. ~~Auto-run migrations on first launch~~ ✅ Done (Phase 4.5) — `prisma migrate deploy` runs inside Electron before the API starts
21. ~~Windows packaging via electron-builder~~ ✅ Done (Phase 4.6) — real NSIS installer + unpacked build, launched and verified on this machine
22. Full clean-install validation on Windows (Phase 4.7) — 🟡 **the manual end-to-end product cycle is now verified working by the user with their real Google account** (7 real bugs found and fixed across two sessions — see `docs/ONBOARDING_AND_MANUAL_SYNC.md`); the one thing still outstanding is running it on a machine that's never had this repo's dev environment on it
22a. New this session, not originally planned: manual "Check now" sync trigger, multi-intervention paging, working Google OAuth from a packaged build, single-user auto-bootstrap — see `docs/ONBOARDING_AND_MANUAL_SYNC.md`
23. Feature stabilization (Phase 4.8) — then Phase 5: Mac transfer
24. **Up next per the user's own stated plan**: automatic/scheduled assistant evaluation (continuous polling every 5–10 min, replacing the manual "Check now" button now that the manual cycle is proven solid)
25. SSE real-time updates
26. Background job scheduler
27. End-to-end testing

See HANDOFF.md for detailed Phase 2/3/4 roadmap.

---

## 🔧 Verification Commands

```powershell
# Check database (from apps/api)
sqlite3 dev.db ".tables"

# Check interventions
sqlite3 dev.db "SELECT title, priority FROM Intervention;"

# Test API
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/health"
```

---

**Status**: Ready for Phase 2 development 🚀
