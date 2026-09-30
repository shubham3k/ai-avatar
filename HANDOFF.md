# Project Handoff Document

**Last Updated:** September 30, 2026 (end of session — next session continues from here)
**Phase Completed:** Phases 1–4.7 (foundation → Google OAuth/Gmail/Calendar → daily context → SQLite, single-process desktop, onboarding, secrets, auto-migrations, Windows packaging), the Sept 18–28 feature stretch (background sync, tray, reminders, dock UI), and **all Zara milestones M0–M9** (see below).

**Current work — Zara, a local-first personal AI agent (design: `docs/decisions/ADR-006-zara-personal-agent.md`, incl. its "Implementation notes"; read it first).** All Zara work is on git branch **`zara-agent`**, created from `main` after checkpoint `3a96d64`. **Not merged into `main` yet** — the user merges after testing everything. Nothing pushed.

Commits: M0 `d96f08a` · M1 `ca77fc2` · M2 `94e6181` · M3 `03b4efa` · M4 voice `30d7394` · M5 proactive `0e51869` · test-feedback fixes `6c6271b` · M6 recall `f1c6cf5` · M7 actions `4add13b` · M8 MCP `fb82e71` · M9 routines `4bfa64e`. Working tree clean.

| Milestone | Status |
| --- | --- |
| M0 housekeeping (ADR-006, Groq token cap) | ✅ |
| M1 brain (OpenAI `gpt-6-luna` + Groq fallback, model picker, usage) | ✅ |
| M2 chat with tools (streaming, history, voice into chat, auto-hide) | ✅ user tested in dev mode |
| M3 memory, redaction, incognito, activity log + undo | ✅ user found "memory doesn't carry across chats" → fixed in `6c6271b` (explicit "remember…" forces a tool call) — re-test |
| M4 voice (hotkey Ctrl+Shift+Space, spoken replies, voice picker, hands-free, interrupt, Hindi/Hinglish) | ✅ user found Hindi/Hinglish recognition weak → `gpt-transcribe` + "Write my Hindi as" setting in `6c6271b` — re-test |
| M5 proactive (briefings, pre-meeting brief, follow-ups, promises in sent mail, held pop-ups, wrap-up) | ✅ in source, not user-tested |
| M6 recall (local search: email/calendar/chats/memory/notes/`Documents\Zara`; people profiles) | ✅ in source, not user-tested |
| M7 actions with approval (email send + 30 s undo, calendar create/move/cancel, writing style) | ✅ in source, not user-tested — **needs Google reconnect** (Settings → Actions) |
| M8 MCP connections (local files, Google Drive, web search, GitHub, Notion, Slack, read-only browser, custom; strict trust) | ✅ in source, not user-tested |
| M9 routines (plain language, Settings → Routines, action routines ask every run) | ✅ in source, not user-tested |

**Where things stand (Sept 30):** the user built the installer themselves — `apps/desktop/release/AI Executive Agent Setup 0.1.0.exe` (Sept 30, 11:16, ~264 MB, built from `4bfa64e`, i.e. includes M0–M9) — and is about to **test all features together**. The next session is for **fixing whatever they report** and finishing pending tasks.

**Pending / known items for the next session:**
1. Fix issues from the user's all-features test (they'll send screenshots/descriptions).
2. Things never verified for real (no OpenAI key or write-scoped Google grant in the dev env): real OpenAI chat/voice (TTS + `gpt-transcribe`), Google reconnect with `gmail.send` / `calendar.events` / `drive.readonly`, a real email send / calendar change, month-of-email backfill, sent-mail promises/follow-ups on real mail, Drive, npx-based connections (need Node.js on the PC), focus detection during a real presentation/Teams/Zoom call, a real morning briefing, **the packaged `.exe` with the new native dependency** (`onnxruntime-node` for the local search model, installed by `prepare-api-resources.mjs` into `resources/api`), and the new Settings tabs / approval cards inside the running Electron app.
3. Known rough edges: Groq's free tier is slow with the bigger tool list (30–70 s per reply in tests) and sometimes narrates ("Let me check…") or writes clumsy phrases; Settings now has 9 tabs (wrapping to two rows); calendar events created < 5 min before start may alert late.
4. After the user is happy: merge `zara-agent` → `main` (their instruction), then rebuild the `.exe` only when they say "build the exe".
5. Later list (ADR-006, not started): Telegram, screen understanding, wake word, time tracking, Ollama/local mode, web dashboard, Mac, behaviour learning with a "What Zara has learned" page; packaging polish (code signing, icon); clean-machine install test.

**How to run:** dev mode — quit any installed copy first (both use port 4000), then `pnpm --filter @ai-agent/shared build`, `pnpm --filter @ai-agent/api build`, `pnpm --filter @ai-agent/desktop electron:dev`. Installer: `cd apps/desktop` → `npm run package:win` (or `npm run package:win:dir` for an unpacked test build) — **only when the user asks**. Starting the app auto-applies Prisma migrations (M5–M9 added `zara_m5_proactive`, `zara_m6_recall`, `zara_m7_actions`, `zara_m8_mcp`, `zara_m9_routines`).

**Keys & data:** OpenAI key in the app's **Settings → General** (encrypted in `%APPDATA%\@ai-agent\desktop\config.json`, shared by dev and installed app). `apps/api/.env` has only a Groq key, so agent live tests run over Groq. `.env.test` blanks AI keys; `tests/setup.ts` also sets `RECALL_DISABLE_EMBEDDINGS=1` and a temp `ZARA_DOCUMENTS_FOLDER` so tests never download the model or touch real Documents. The local search model downloads on first use to `%APPDATA%\@ai-agent\desktop\models`. **Live checks always run on a COPY of `apps/api/prisma/dev.db`** (in the session scratchpad; migrate the copy with `DATABASE_URL=file:<copy> npx prisma migrate deploy`) — never the user's real data; new migrations are created with `prisma migrate dev` against a scratch DB, never `dev.db`.

**Working rules with this user:** first check `git branch --show-current` = `zara-agent` and a clean tree; briefly confirm a plan before building anything sizeable (they answer quickly); discuss before new directions; after each change run typecheck + lint + all tests (API + desktop) and a live check where possible; update HANDOFF.md / CURRENT_STATUS.md / ADR-006; commit on `zara-agent` (fine without asking); **never push, never rebuild the `.exe` unless they say "build the exe"**; their OpenAI key/tokens go in the app's Settings, never in chat. Tooling notes: pnpm 11 needs every package with install scripts listed under `allowBuilds` in `pnpm-workspace.yaml`; in Git Bash, heredocs containing backticks break — write patch scripts to a file instead.

---

## Addendum: Zara M9 — routines (September 30, 2026) — all milestones built

On branch `zara-agent`. **With M9, every ADR-006 milestone (M0–M9) is in source.** The user asked to build them all and then test everything together; `zara-agent` has **not** been merged into `main` yet (waiting for that test).

- **Routines** (`domain/routines/`, migration `zara_m9_routines`: `Routine`, `RoutineRun`): created in plain language — the model extracts title / instruction / frequency (daily, weekdays, weekly on given days, monthly on day N, once) / time / "takes action"; **code computes every run** (`nextRunAfter`, local time; monthly 31st → last day of short months; one-off times go through the proven reminder parser). Chat tools `create_routine` (the user's words), `list_routines`, `change_routine` (pause / resume / reschedule in words / delete); **Settings → Routines** tab (create, on/off, Run now, Edit instruction or timing, Delete). Created/deleted routines are in Activity with Undo.
- **Running:** the desktop's 15 s delivery tick calls `POST /routines/run-due` (returns at once); due routines are claimed atomically (next run moved first — never twice; a PC that was off catches up with one run) and run in the background as Zara's normal agent in "routine mode" (prompt v10: the user isn't watching, write a short report, prepare cards for anything that sends/changes). In a run Zara **can't create routines or approve anything** (`create_routine`, `change_routine`, `approve_calendar_in_chat` aren't offered), so action routines ask on every run by construction. Each run is saved as a chat "Routine: <title> · <date>" and ends with an alert card — "<title> — ready" (medium), "— needs your approval" (high, when it prepared cards), or "— didn't finish" — whose **Read it** button opens the report in the chat. One-off routines switch off after running. Behaviour learning stays postponed (ADR-006 §10).
- **Tests:** API 736/736, desktop 259/259, shared 10/10, typecheck + lint clean.
- **Live check** (Groq, DB copy): "every Monday at 9, summarize unanswered emails" → Every Monday at 9:00 AM; "har weekday shaam 6 baje kal ki meetings batao" → Every weekday at 6:00 PM (instruction kept in Hinglish); "on the 1st of every month at 10am…" → Monthly on the 1st; "every friday at 5pm email my team a weekly update" → marked "asks every run". A forced run produced "Weekly unanswered emails — ready" with the report (~34 s on Groq's free tier). Groq sometimes starts the report with "Let me check…" and uses a markdown heading.

---

## Addendum: Zara M8 — MCP connections (September 30, 2026)

On branch `zara-agent`. New packages (approved): `@modelcontextprotocol/sdk` (official client) and `@modelcontextprotocol/server-filesystem` (bundled).

- **Connections** (`domain/mcp/`, migration `zara_m8_mcp`: `McpConnection`, `McpToolPolicy`, `PendingAction.result`): presets in the agreed order — **Local files** (bundled filesystem server, run on the app's own runtime: `process.execPath` + `ELECTRON_RUN_AS_NODE=1` — no install; limited to folders picked in the native dialog), **Google Drive** (built in: `drive_search` / `drive_read` over `drive.readonly` — Docs/Sheets(CSV)/Slides export, text files ≤ 1 MB, 6,000 chars), **Web search** (Brave), **GitHub**, **Notion**, **Slack** (npm servers run via `npx -y <pkg@major>` — needs Node.js on the PC; downloaded the first time), **Browser (read-only)** (`@playwright/mcp`, only navigate/snapshot/tabs/back/wait/close — no clicks, typing, forms), and **Custom** (the user's own command). Only the user can add connections (no Zara tool for it). Secrets are stored encrypted (`encryptSecret`) and never returned to the UI (only which ones are saved). Servers start in the background; a chat waits at most 2.5 s for ones still starting.
- **Strict trust:** every connection tool asks first — a `mcp_call` approval card ("🔌 Google Drive — Zara wants to use drive_search", risk badge reads only / changes things / ⚠ can delete or overwrite, the exact input). Only **read-only** tools can be trusted (card button "Always allow", or Settings → Connections → "don't ask"); tools that change or delete things always ask; approval is click-only (never in chat). Risk comes from the server's `readOnlyHint`/`destructiveHint`, else a cautious name-based guess (unknown → treated as changing things). Tool output is capped at 4,000 chars and labelled as data, not instructions; every call is logged in Activity. After a card is approved the desktop sends "✓ Approved …" with `continueActionId`, and the agent hands the stored result to the model with that message.
- **Tools to the model:** up to 40 connection tools per turn, named `mcp_<connection>_<tool>` (≤ 64 chars, API-safe); descriptions prefixed with the connection and "changes things, always asks" where relevant. Prompt v9.
- **Settings → Connections tab** (`ConnectionsSettings.tsx`): each connection's status (Ready · N tools / Starting / Problem: …), on/off, Restart, Remove, per-tool "use" and "don't ask" (disabled for non-read-only tools); Add buttons per preset (token fields as password inputs with help text; Local files opens the folder picker in the main process — the renderer never sends paths).
- **Tests:** API 728/728, desktop 256/256, typecheck + lint clean — incl. a **real run of the bundled filesystem server** (reads a file in the chosen folder; reading outside it is refused), trust rules, browser allowlist, secret encryption, the card → approve → continue flow, and trusted tools running without a card.
- **Live check** (Groq, DB copy, real Local files server on a test folder): "What's the offsite budget? It's in offsite.txt…" → a `read_text_file` card; after approval Zara answered "The offsite budget is 3.5 lakh — Goa, 14–16 November, owned by Priya."
- **Needs the user:** Drive (after the Google reconnect from M7), and tokens for web search / GitHub / Notion / Slack; the browser preset downloads a browser on first use.

---

## Addendum: Zara M7 — actions with approval (September 30, 2026)

On branch `zara-agent`.

- **Google permissions:** sign-in now also asks for `gmail.send` (send only — no mailbox changes), `calendar.events` and `drive.readonly` (for M8). `grantedCapabilities(scopes)` reports what the stored grant covers; an older connection keeps working read-only until the user clicks **Settings → Actions → Reconnect Google to allow it**. `AGENTS.md`'s Phase-1 "read-only scopes" rule is updated accordingly; the OAuth test now asserts send-only / events-only / read-only-Drive and never modify/full-account scopes.
- **Approval layer** (`domain/actions/`, migration `zara_m7_actions`: `PendingAction`, `ActionSettings`, `DraftEdit`): Zara's tools can only **propose** (`draft_email`, `propose_calendar_event` / `_change` / `_cancel` — tier `external`); each creates a card streamed into the chat (`{type:"action"}` SSE event) and the tool result tells the model nothing has happened yet. Payloads (Zod, per kind) are validated on propose, on every edit, and again before execution. **Email:** Approve is only accepted from the user's click (IPC → `POST /actions/:id/approve`, `via: "click"`); it then waits **30 s** (`status: sending`, countdown + **Undo** on the card) and is sent exactly once (claimed atomically; an in-process timer plus the desktop's 15 s tick calling `/actions/execute-due` as backup). A send whose window passed while the app was closed goes back to "approve again", never out late. Replies thread properly (In-Reply-To/References + threadId); subjects are RFC 2047-encoded (Hindi); headers can't be injected. **Calendar:** own-only changes (nobody notified) may be approved in chat (`approve_calendar_in_chat`, refused for email and for anything that notifies others); attendees get Google's own emails (`sendUpdates: all`) only when there are attendees. Times come from the user's words through the proven reminder parser. The card shows the exact email / before → after / who gets notified, **⚠ first-time recipients**, Edit (To/Cc/Subject/Body or Title/Start/End), Cancel.
- **Activity + Undo:** `email_sent` (no undo after sending — the 30 s window is the undo), `calendar_created` (undo deletes it), `calendar_updated` (undo restores the before-snapshot), `calendar_cancelled` (undo recreates it; attendees re-invited), `action_cancelled` (every cancel/undo). The local calendar table is updated after each change.
- **Writing style:** Settings → Actions has the user's style notes; `get_writing_style` (called before drafting) returns them plus 2 short samples of the user's sent mail and their last 3 edits to Zara's drafts (recorded when they change a draft's text before sending).
- **Desktop:** `ActionCard.tsx` + `use-action-cards.ts` (cards persist in the DB, refreshed when the chat opens; the panel never auto-hides while a card waits); **Settings → Actions** tab (permission status + reconnect, writing style). Prompt v8.
- **Tests:** API 718/718, desktop 248/248, typecheck + lint clean. Cover MIME building/injection, scopes, 30 s window, exactly-once send, Undo, chat-approval refusal for email, first-time recipients, edits → DraftEdit, restart recovery, permission errors, calendar create/update/cancel with notify rules and Undo, and that the agent only creates a card.
- **Live check** (Groq, DB copy, fake Gmail/Calendar that can't send): "Email priya@example.test that the launch deck is ready…" → `get_writing_style` then a correct draft card with Priya flagged as a first-time recipient — **0 emails sent**; "kal dopahar 3 baje 1 ghante ke liye Focus time calendar mein daal do" → a card for Thu 1 Oct 3:00–4:00 PM, approvable in chat, reply in Hinglish. **Groq's free tier took 38–72 s per reply** here (more tools = bigger prompts → rate limits); OpenAI should be far faster.
- **Needs the user:** reconnect Google to grant the new permissions (if the OAuth app is in Google's "testing" mode, the user must be a test user), then a real send / calendar change.

---

## Addendum: Zara M6 — recall (September 30, 2026)

On branch `zara-agent`. The user asked for M6–M9 to be built before testing everything together, and approved: `@huggingface/transformers` (local embeddings), `@modelcontextprotocol/sdk` (M8), downloading the search model `Xenova/multilingual-e5-small` (~130 MB on disk) and the filesystem MCP server for testing. Also added (small, pure JS): `unpdf` (PDF text) and `mammoth` (Word .docx text).

- **Index** (`domain/recall/`): `RecallChunk` table (migration `zara_m6_recall`) — one row per chunk of an email, calendar event, chat, memory fact, note, or document, with a content hash (unchanged sources are never re-processed) and a float32 embedding. The **FTS5 keyword index** (`RecallChunkFts` + triggers) is created at runtime by `recall-store.ts` (Prisma would drop an unknown virtual table in a later migration); LIKE fallback if FTS5 is missing. Search = FTS5 bm25 + cosine over local embeddings, merged by reciprocal-rank fusion; meaning matches below 0.8 similarity are dropped (live: related 0.90, unrelated 0.74). User text is quoted into FTS queries (no operators). ~10–30 ms per search.
- **Local model** (`embedder.ts`): `Xenova/multilingual-e5-small` (English/Hindi/Hinglish, q8, CPU via onnxruntime-node) loaded lazily; downloaded on first use to `RECALL_MODEL_DIR` (Electron sets `%APPDATA%\@ai-agent\desktop\models`); a failed load retries after a minute and keyword search keeps working meanwhile. Tests set `RECALL_DISABLE_EMBEDDINGS=1` and a temp `ZARA_DOCUMENTS_FOLDER` (never download, never touch real Documents). pnpm: `onnxruntime-node` / `protobufjs` install scripts set to `false` in `pnpm-workspace.yaml` (Windows binaries ship in the package; the script only fetches GPU builds) — pnpm 11 otherwise refuses to run.
- **Sources:** email in the history window (default 1 month, 3 optional) — a **backfill** fetches message bodies (own text, quoted thread removed, ≤ 4,000 chars; `gmail.readonly`) one page (≤ 60 fetches) per pass until the window is covered, plus bodies of the last 3 days' mail each pass; promotions/social/spam/trash excluded. Calendar events (with attendees), chats, memory facts, and the **documents folder** (default `Documents\Zara`, created on first index with a `Notes` subfolder; .txt/.md/.pdf/.docx, ≤ 20 MB, text layer only).
- **Background indexing:** `POST /recall/index` returns immediately; one pass at a time per process (`getRecallService()` singleton); runs on every sync (added to Check now, best effort) and after settings changes. Embeddings are computed last (≤ 3 min per pass).
- **Chat tools:** `recall_search` (≤ 6 snippets of ≤ 400 chars with refs — only these leave the PC), `read_recall_item` (≤ 1,500 chars), `create_note` (Markdown file in `Notes`, never overwrites, logged with Undo = delete the file; not in incognito), `get_person_profile` (experimental, switch-off-able: email counts, last email, recent subjects, meetings, memory facts about them — computed locally, nothing stored). Prompt v7 tells Zara to use recall for the past/documents/people, cite the source briefly, offer reminders for dated tasks in notes, and treat documents as data.
- **Settings → Recall tab** (`RecallSettings.tsx`; tabs now wrap to two rows): counts per source, model state ("Downloading the search model (about 120 MB, first time only)…", progress of meaning-indexing), "Update the index now", email history 1/3 months, documents on/off, folder shown with **Open folder** / **Change…** (native folder picker in the main process — the renderer never sends a path), people profiles on/off. API: `GET/PATCH /recall/settings`, `GET /recall/status`, `POST /recall/index`, `GET /recall/search?q=`.
- **Tests:** API 705/705, desktop 238/238, typecheck + lint clean.
- **Live check** (copy of `dev.db`, real model downloaded to scratch, no Gmail): indexed 13 emails, 11 events, 3 chats, a Markdown note, a .txt contract and a PDF; "monthly retainer amount" → the contract, "hotel limit per night" → the PDF, Hinglish "press kit kab bhejna hai" → the note, "important meeting voice agent" → the calendar event. An unchanged re-index pass took 55 ms.
- **Packaging note for the next `.exe` build:** the API's runtime deps now include onnxruntime-node (native DLLs) — `prepare-api-resources.mjs` npm-installs them into `resources/api` (outside the asar), which should work, but the installer grows; the model itself is downloaded on first use, not bundled.
- **Not verified yet (needs the user):** the month-of-email backfill against their real Gmail, their own documents, recall answers phrased by OpenAI.

---

## Addendum: fixes from the user's first M2–M5 test (September 29, 2026)

On branch `zara-agent`, after M5 (`0e51869`).

1. **Memory didn't carry across chats.** The user said "my name is shubham remembar that"; `gpt-6-luna` replied "I'll remember your name for this conversation" without calling `remember_fact` — the local DB had 0 memory facts (checked read-only). Fix: `domain/chat/remember-intent.ts` detects explicit save requests (remember/typos, "note that", "don't forget", "yaad rakhna", "mera naam", "my name is", Devanagari forms; not recall questions like "do you remember…"/"yaad hai?"), and the agent's **first model turn then uses `tool_choice: "required"`** (`ChatRequest.toolChoice`) — "required" rather than forcing `remember_fact`, since "remember to call Rahul at 5" is a reminder. Prompt v6: memory is permanent across chats, the user's name counts, never say "only for this conversation". Live (Groq, DB copy): name + "yaad rakhna ki Rahul mera manager hai" saved, then recalled in a **new** chat.
2. **Hindi/Hinglish voice accuracy.** OpenAI transcription default `gpt-4o-mini-transcribe` → **`gpt-transcribe`** (the upgrade path already named in ADR-006; ~$0.0045/min vs $0.003), sent `languages: ["en","hi"]` (only to models that accept it). The prompt is now an example sentence in the wanted style (transcription models follow the prompt's language and script). New **Settings → Voice → "Write my Hindi as": Roman letters (Hinglish, default) / Devanagari**, passed as `script` on `POST /chat/transcribe`. Groq backup transcription `whisper-large-v3-turbo` → `whisper-large-v3` (better at Hindi). Not verifiable here without the user's OpenAI key.
3. Sent-mail features: not yet tested by the user.

Tests: API 694/694, desktop 233/233, typecheck + lint clean.

---

## Addendum: Zara M5 — proactive (September 29, 2026)

On branch `zara-agent`. Plan confirmed by the user: briefing/wrap-up appear **in the chat panel**; sent emails go to the AI with the **trimmed body**; busy/video-call detection via a **PowerShell helper** is OK.

- **Data** (migration `zara_m5_proactive`): `ProactiveSettings` (one row per user — all switches/times below plus `lastBriefingOn`/`lastWrapUpOn` local-date markers); `Email.sentAnalyzedAt / expectsReply / followUpCheckedAt / repliedAt`; `Reminder.origin` ("promise") + `sourceEmailId`.
- **Settings → Proactive tab** (`ProactiveSettings.tsx`, saves each change immediately via `GET/PATCH /api/v1/proactive/settings`; IPC `proactive:get-settings / update-settings`, patch field/type-checked in `parseProactivePatch`). Defaults: briefing on, written, every day; wrap-up on at 18:00; pre-meeting brief on; follow-ups on after 3 days; promise reminders on (day before 10:00, 2 h before if due today); hold during focus on; quiet hours off (22:00–07:00). "Show today's briefing now" / "Show wrap-up now" buttons (`force`).
- **Morning briefing / wrap-up** (`domain/proactive/briefing.service.ts`, `briefing-schedule.ts`, `POST /proactive/briefing {kind, force?}`): due logic is pure (`isBriefingDue` — morning from 05:00 until the wrap-up time, optionally weekdays only; wrap-up from its time until midnight); the day is claimed atomically (`claimDelivery`) so it's never sent twice. Facts gathered locally (today's meetings with done/upcoming status and attendees, reminders, open alerts, promises due in 2 days; wrap-up adds tomorrow's first meeting/reminders), one AI call writes it (no tools; template fallback if the AI is down), saved as a chat "Morning briefing · Tue 29 Sep" with one assistant message. Desktop: `proactive-scheduler.ts` checks every minute **only while the user is at the PC** (system idle < 2 min) and on `unlock-screen`/`resume`, never while held or paused; the renderer opens the chat (written), speaks it (spoken — panel stays closed, chat still in 🕘), or both; an open briefing stays up ≥ 2 min before auto-hide.
- **Pre-meeting brief** (`meeting-brief.ts`, attached as `actionPayload.brief` by calendar detection; rendered in `InterventionMessage.tsx`): who's coming (organizer + accepted/tentative, minus the user), the 3 latest emails with them (14 days), open alerts/reminders mentioning them. Local only, no AI call; never blocks the alert.
- **Sent mail** (`sent-mail.service.ts`, `POST /proactive/sent-mail`, added to Check now / the 5-minute sync after Gmail detect-signals — best effort, a failure doesn't stop the sync): `gmail-sent.service.ts` lists `in:sent newer_than:14d` (≤ 25, `gmail.readonly`, no new consent) and keeps only the user's own text (quoted thread and "-- " signature removed, ≤ 4,000 chars) in `Email.bodyText`. Each new sent email is analysed **once** (structured output, redacted at the provider boundary, ≤ 3,000 chars): `expectsReply` + promises. **The model only reports what kind of deadline was said** (`today / tomorrow / weekday / end_of_week / next_week / date`) — `resolvePromiseDate` does the calendar maths relative to the sent date (live Groq test showed the model resolving "by Friday" wrongly 1 in 3 times when asked for a date). `computePromiseReminder`: day before at 10:00, or 2 h before if due today (too late → as soon as possible; past due → skipped); promise without a time = 17:00. Each promise reminder is logged in Activity with Undo. **Follow-ups**: sent + `expectsReply` + older than N days + no reply → checks local thread rows, then the Gmail thread (metadata) → "No reply from Rahul yet" card (Done / Remind later / Open thread); re-checked at most every 12 h; nothing older than 14 days. Both features off → no sent mail is read at all.
- **Held pop-ups** (`focus-monitor.ts` + `proactive-scheduler.ts` `computeHold`): a hidden PowerShell helper prints every 5 s Windows' own `SHQueryUserNotificationState` (busy / full-screen D3D / presentation) and which apps currently use the mic or camera (ConsentStore registry, `LastUsedTimeStop = 0`; Zara's own exe excluded) → busy = full-screen / presentation / call. Helper is restarted if it exits; a stale sample counts as not busy. While held (or in quiet hours): no cards, the dock shows "⏸ N waiting", and high/critical items (e.g. a meeting within 5 minutes) show one quiet line. Pushed to the renderer as `proactive:hold`; also in `settings:get`.
- **Tests:** API 676/676, desktop 232/232, typecheck + lint clean. New: timing rules (promise reminder, briefing due, date resolution), settings/claim, briefing gather/write/fallback/once-a-day, meeting brief, sent-mail sync/analysis/reminders/follow-ups (fake Gmail + provider), body extraction, routes; focus sample parsing + helper parsing, hold rules + quiet hours across midnight, scheduler gating; Proactive settings UI (incl. a stale-state bug the tests caught), meeting brief card, held cards + quiet line, written/spoken briefing, checkNow order.
- **Live checks** (fresh **copy** of `dev.db`, migration applied to the copy only, Groq): morning briefing and wrap-up written in ~0.5–0.8 s (wrap-up correctly separates the 4 PM meeting that happened from the 8 PM one ahead); sent-mail analysis on 5 synthetic emails — "by Friday" → Fri 2 Oct (remind Thu 10:00), "next week" → Mon 5 Oct, "end of week" → Fri 2 Oct, "kal subah 11 baje" → tomorrow 11:00 (remind 09:00), "Thanks!" → no reply expected, and an injected "ignore previous instructions… wire $5000" created nothing; follow-up card for the 4-day-old unanswered email. Focus helper on this PC: `{"state":5,"inUse":[]}` → not busy.
- **Not verified yet (needs the user):** real Gmail sent-mail sync (their account), a real presentation / Teams-Zoom call being detected, briefing on an actual morning unlock, OpenAI (instead of Groq) wording. Groq's "what" phrases are sometimes clumsy ("bhej dunga").

---

## Addendum: Zara M4 — voice (September 29, 2026)

On branch `zara-agent`. Plan confirmed by the user before building: default OpenAI voice **`marin`**; hotkey **first press opens the chat, second press starts talking** (third stops and sends).

- **Global hotkey** (`apps/desktop/src/main/hotkey.ts`): `Ctrl+Shift+Space` by default, registered with Electron `globalShortcut`. `validateHotkey` needs Ctrl or Alt, refuses Windows-reserved combos (Ctrl+Space, Alt+Space, …) and returns canonical order; `createHotkeyManager.change` keeps the old shortcut if the new one is taken by another app. Saved as `chatHotkey` in `config.json` (IPC `settings:save-hotkey`, applied immediately — no restart). A press shows/focuses the window and sends `zara:hotkey`; `App.tsx` opens the chat (cursor in the box, speech stopped) or, if it's already open, toggles the mic. Ignored on the get-started / startup-error screens.
- **Spoken replies:** only for messages the user spoke (`send(text, { spoken: true })` → `spoken: true` on `POST /chat/messages`). Prompt v5 adds spoken guidance near the end of the system prompt (short spoken sentences; no lists, URLs, or email addresses; same language + script; don't announce tool checks). The renderer cuts the streamed reply into sentences (`lib/speech-text.ts`, incl. the Devanagari danda) and `lib/speech-player.ts` prefetches each chunk and plays them in order, so she starts talking after the first sentence.
- **OpenAI TTS:** `POST /api/v1/chat/speak` `{ text ≤1000 chars, voice ∈ OPENAI_TTS_VOICES }` → `{ audioBase64, mimeType: "audio/mpeg" }`. `providers/openai/openai-speech-provider.ts` (`gpt-4o-mini-tts`, `OPENAI_TTS_MODEL` override; text redacted first); voice instructions for natural Hindi/Hinglish pronunciation in `domain/speech/speech.service.ts`. Speech is a separate `SpeechProvider`, not part of `LlmProvider` — **no Groq fallback** (Groq's voices don't speak Hindi); the desktop falls back to a **Windows voice** and shows the reason once. Usage: operation `speech`, audio seconds estimated from the text (~15 chars/s), priced at $0.015/min.
- **Windows voices** (`lib/speech-output.ts`): Chromium `speechSynthesis` (SAPI, offline). Devanagari chunks use an installed Hindi voice when one exists. **This PC has only English voices** (David, Zira, Mark) — for Hindi script add one in Windows Settings → Time & language → Speech → Add voices → Hindi.
- **Settings → Voice tab** (`VoiceSettings.tsx`): shortcut capture box; Zara's voice OpenAI (default) / Windows / Off; OpenAI voice picker (marin default); Windows voice picker (also used as the fallback voice); ▶ Preview ("Hi, I'm Zara. Aaj aapka din kaisa chal raha hai?"); Click to talk (default) / Hands-free. Stored in renderer localStorage (`zara.voice`).
- **Hands-free** (`lib/hands-free-listener.ts` + pure `lib/voice-activity.ts`): the mic stays open while the chat is open; RMS voice-activity detection with an adaptive noise floor; 1.2 s of silence ends a turn; a recording always runs so the first syllable isn't lost (restarted after 8 s of silence to keep clips short); echo cancellation on; 60 s with no speech turns it off with a note. Something said while Zara is still answering is sent right after.
- **Interruption:** typing, clicking 🎤, the hotkey, sending anything, New chat / opening a chat, closing the panel, or (hands-free) talking over her — which needs louder, ≥0.4 s sustained speech while she's speaking, so her own voice leaking into the mic doesn't cut her off. The chat shows "Zara is speaking… [Stop]".
- **Hindi/Hinglish:** transcription sends a language hint ("English, Hindi, or Hinglish"); the spoken prompt keeps Devanagari → Devanagari and Hinglish → Hinglish.
- **Tests:** API 649/649, desktop 208/208, typecheck + lint clean. New tests cover the speech provider/service/route, pricing, spoken prompt, hotkey validation + manager, sentence chunker, speaker queue/interrupt/fallback, VAD with simulated levels, Settings → Voice, ChatPanel interrupt/hands-free, App hotkey, and the hook's voice flow.
- **Live checks** (API on port 4100 against a **copy** of `dev.db`, Groq only): `/chat/speak` without an OpenAI key → 400 "Add your OpenAI API key in Settings to use Zara's OpenAI voice." (the desktop then uses a Windows voice); unknown voice → 400. Spoken chat over Groq: Hinglish question → Hinglish answer, Devanagari → Devanagari, 1–2 sentences. A Windows-voice WAV was transcribed correctly through Groq with the hint. Standalone Electron check: `Ctrl+Shift+Space` registers on this PC, changing to Alt+Shift+Z releases it, Ctrl+Space is refused.
- **Not verified yet (needs the user):** the real OpenAI voice (key is in the user's Settings, not dev `.env`), the hotkey and hands-free inside the running app, and echo behaviour on speakers. Known: the Groq fallback model sometimes still says "Let me check…" before a tool call, which then gets read aloud.

---

## Addendum: Zara M3 — memory, redaction, incognito, activity log (September 29, 2026)

On branch `zara-agent`.

- **Data:** `MemoryFact` (content, category about_you/people/preferences/other) and `ActivityEntry` (kind, summary, provider, `undo` JSON, `undoneAt`) — migration `zara_m3_memory_activity`.
- **Redaction** (`domain/privacy/redaction.ts`): passwords/PINs/OTPs, Luhn-valid card numbers, Aadhaar (standalone 12 digits only), PAN, labelled bank-account and passport numbers → `[redacted]`. Enforced at the provider boundary by `providers/llm/redacting-provider.ts` (`withRedaction`, applied in `createLlmProvider` around primary + fallback), so chat, reminder parsing, and prioritization can't leak them; memory refuses to store them.
- **Memory:** `domain/memory/memory.service.ts` (dedupe ignoring case, refuses sensitive, 300-char cap). Facts (most recent 60) go into Zara's system prompt with ids for tools. New tools: `remember_fact`, `update_fact`, `forget_fact`, `search_chats` (LIKE over past messages). Prompt v4 tells Zara when to save ("Noted: …") and to fix wrong facts.
- **Activity log:** `domain/activity/activity.service.ts` — every reminder create/delete and memory save/update/delete is logged with the provider that was answering and a stored inverse; `undo` applies it deterministically (409 with a clear message if the target is already gone / already undone).
- **Incognito:** request `{ incognito: true, history }` — nothing stored, no conversation id, memory-write tools not offered (and refuse if called), prompt says so; the client keeps and resends the history (validated/capped in IPC).
- **API:** `GET/PATCH/DELETE /memory/facts[/:id]`, `GET /activity`, `POST /activity/:id/undo`, `DELETE /activity`, `DELETE /chat/conversations[/:id]`; routes share `routes/caller.ts`.
- **Desktop:** Settings now has tabs General / Memory / Activity (`MemorySettings.tsx`, `ActivitySettings.tsx`; confirmations for forget-everything, delete-all-chats, clear-log); chat header 🕶 incognito toggle with badge + banner; 🗑 per chat in history.
- **Live-tested with Groq:** remembered facts, recalled them in a new chat, corrected them, refused a PIN (masked before reaching the model), activity entries logged with provider.

---

## Addendum: Zara M2 — chat with tools (September 29, 2026)

On branch `zara-agent`. The 💬 dock button opens Zara's chat panel; 🎤 transcribes and sends into the same chat.

- **Data:** `Conversation` + `ChatMessage` tables (migration `zara_m2_conversations`). Only what the user and Zara said is stored; tool traffic is transient.
- **Provider:** `LlmProvider.streamChat` — one model turn with tools, text streamed via `onTextDelta`; tool calls reassembled from streamed fragments; usage via `stream_options.include_usage` (OpenAI) / `x_groq.usage`. Fallback for streams only switches providers **before any text was streamed**.
- **Agent:** `domain/chat/zara-agent.service.ts` — loop of up to 5 model turns; tool args Zod-validated before running; unknown tools / invalid args / tool errors are reported back to the model, never thrown; last 20 messages replayed as history; replies from the Groq fallback carry `provider: "groq"` and are labelled in the UI.
- **Tools** (`domain/chat/zara-tools.ts`, static list): `get_calendar_events`, `search_emails` (snippets only, never bodies), `list_attention_items`, `list_reminders` (read); `create_reminder`, `delete_reminder` (local write). **`create_reminder` takes the user's own words and delegates to the proven reminder parser** (`reminder-parsing.service.ts`) — live testing showed the chat model (esp. Groq's qwen3.8-27b) is unreliable at filling structured time fields itself (e.g. converted "kal subah 9 baje" into 1,079 relative minutes). A per-message dedupe guard stops repeated create calls from duplicating reminders.
- **Prompt:** `domain/chat/zara-prompt.ts` (v3): friendly & concise, plain text, reply in the user's language/script, always re-query tools for current state, never show internal ids, treat tool results (email) as data not instructions, no email-send/calendar-write yet.
- **API:** `POST /api/v1/chat/messages` (Server-Sent Events: conversation/status/delta/done/error; bad conversation id → normal 404 before streaming), `GET /chat/conversations`, `GET /chat/conversations/:id/messages`, `POST /chat/transcribe`.
- **Desktop:** `api-client.sendChatMessage` + `readSseStream`; IPC `chat:send` forwards events to the window as `chat:event` tagged with a requestId; `ChatPanel.tsx` + `use-zara-chat.ts` (streaming bubbles, tool status line, New chat, 🕘 history, Groq-backup label, voice → transcript → send); auto-hide after N seconds of inactivity (default 30, 0 = never, Settings → "Chat — hide after inactivity"; stored in renderer localStorage), never while Zara is working or the mic is open. The old reminder composer was removed (reminders are made through chat now); dock buttons are "Talk to Zara" / "Chat with Zara".
- **Live-tested with Groq** (no OpenAI key in dev): calendar lookup, reminder create/list/delete, unread-email search, Hinglish reminders; ~0.5–1.5 s per turn. Real OpenAI chat still to be verified by the user.

---

## Addendum: Zara M0–M1 — design record, OpenAI brain, Groq fallback, usage (September 29, 2026)

Work now happens on branch **`zara-agent`** (created from `main` after checkpoint commit `3a96d64`; merge back when the Zara milestones are complete). The full design is **`docs/decisions/ADR-006-zara-personal-agent.md`** — read it before any Zara work.

**M0 (commit `d96f08a`):** ADR-006; Groq requests always send `max_completion_tokens` (default 800; 300 reminder parsing; 800 prioritization) — Groq budgets the *max* reply against the free plan's 1,000 output tokens/min, so the unset default (2048) was rejected on every call; 429s aren't retried immediately.

**M1 — the brain:**
- `providers/llm/`: provider-neutral `LlmProvider` + typed `LlmProviderError` (kind, detail, provider); one `openai-compatible-client.ts` serves OpenAI and Groq; `fallback-provider.ts` (backup only on 429/5xx/network — never on bad key, retired model, or bad request); `create-llm-provider.ts` (OpenAI key → OpenAI + optional Groq fallback; Groq key only → Groq alone; none → OpenAI "not configured").
- `providers/openai/openai-provider.ts`: default `gpt-6-luna`, transcription `gpt-4o-mini-transcribe`; every chat call sends `store: false` and `reasoning_effort: "none"` (luna is a reasoning model; Chat Completions only supports function calling at "none", and reasoning would eat `max_completion_tokens`).
- `groq-client.ts` is now a thin wrapper re-exporting the old names (`GroqProviderError` etc.).
- All three AI call sites (reminder parsing, voice transcription, prioritization) use `createDefaultLlmProvider()` (`domain/llm-usage.service.ts`); provider failures are worded by `domain/llm-failure-messages.ts` and name the provider that actually failed.
- Usage: new `LlmUsage` table (migration `zara_m1_llm_usage`, counts only — never content), `pricing.ts` (Sept 28 prices; estimate only, Groq counted not costed), `GET /api/v1/usage/summary`.
- `env.ts`: `OPENAI_API_KEY/OPENAI_MODEL/OPENAI_TRANSCRIBE_MODEL`; empty values now mean "unset" (a blank `OPENAI_MODEL=` was being used as the model name). **`apps/api/.env.test` blanks the OpenAI vars too** so tests can never make real, billed OpenAI calls.
- Desktop: OpenAI key + model stored encrypted in `config.json` (`app-config.ts` now iterates a field list); Settings has "AI provider (OpenAI)" at the top (key, model picker cheapest→most capable, usage this month) and Groq relabelled "backup, optional"; first-run gate accepts an OpenAI key (or Groq alone); voice clips report their duration for the transcription estimate.
- Verified: API 584/584, desktop 141/141, typecheck + lint clean; live: Groq-only path works; an invalid OpenAI key reaches OpenAI and is reported ("Your OpenAI API key was rejected…") without silently falling back. **A real OpenAI answer has not been verified yet** — no OpenAI key in the dev env; the user tests it in the built app.

---

## Addendum: Reminder timing rework, on-time delivery, real error messages (September 25, 2026)

**Not committed; source only — the `.exe` has NOT been rebuilt with these changes (user asked to hold off).** Design recorded in `docs/decisions/ADR-005-reminder-timing.md`.

**Why:** the user's retest of the rebuilt `.exe` (built Sept 24, 18:19 — includes the Settings-scroll fix, the idle-box removal, and a 30% larger character, `.intervention-character .character` 96×144 → 125×187) reported "mic button not working". Investigation found:
1. **The mic worked** (Windows logged the app using it). The Groq key had been revoked/rotated → every Groq call 401'd, and Settings showed "Could not understand… try rephrasing" for *every* failure, hiding the real cause. The user has since updated the key.
2. **Timezone bug:** the parser sent Groq `now` in UTC while the prompt claimed local time — "3:40 pm" was stored as 15:40 UTC (9:10 PM IST).
3. **Lead-time bug:** Groq also picked the lead time, so "remind me in 10 minutes" fired immediately.
4. **Late delivery:** reminders were only checked in the 15-minute Gmail/Calendar sync (and only with Google connected); calendar meetings alerted anywhere in a 30-minute window.

**User's rules (now implemented):** "remind me at 4pm" → 4:00 exactly; "remind me in 10 minutes" → exactly then; "meeting at 5pm" → 4:50; Google Calendar event at 4pm → 3:50.

**What changed:**
- **LLM extracts intent, code computes times.** Prompt v2 + new schema (`reminder-parse-prompt.ts`, `reminder-parse-schema.ts`): Groq returns `{reminderText, kind: ping|event, timeType: relative|clock|none, relativeMinutes, date, time, leadMinutes}`. New pure `domain/reminder-timing.ts` computes `dueAt`/`remindAt` in local time (ping = exact; event = 10 min early or the explicit lead; never in the past; today's date treated as a bare time; no time → "When should I remind you?"). One automatic retry on transient Groq failures (never on a bad key).
- **Typed Groq errors** (`GroqProviderError` with `kind`) → user-facing messages from the API ("Your Groq API key was rejected. Update it in Settings.", etc.), passed through `ApiClientError.apiMessage` → IPC `{ok, reminder} | {ok:false, message}` (`toReminderCreateResult`) → shown as-is in Settings. Mic errors distinguish blocked / no device / busy.
- **1-minute local delivery tick** (`sync-scheduler.ts`, `ApiClient.checkDue`): runs only reminder + calendar detect-signals against local SQLite, no Google/Groq calls, no Google-connected requirement, shares the in-flight guard with the 15-minute sync, silenced by Pause.
- **Full background sync 15 → 5 minutes** (`config.ts` default; `DESKTOP_SYNC_INTERVAL_MINUTES` still overrides, 5–30). The user's retest: an email received at 4:45:42 missed the 4:44 sync and wasn't due until 4:59 — confirmed from the app DB's own sync timestamps (3:29, 3:59, 4:14, 4:44…), i.e. the scheduler works, the interval was just too long.
- **Calendar window 30 → 10 minutes** (`upcoming-meeting.rules.ts`; `docs/CALENDAR_SIGNALS.md` updated).
- Heads-up reminder popups now say "Meeting — in 10 minutes."; Settings help text and confirmation line updated.

**Verified:** workspace typecheck + lint clean; API 555/555, desktop 127/127 (`assistant-evaluate.api.test.ts` hit its known hook-timeout flake once under full-suite load, passed standalone and on the full re-run). Live Groq run of the user's phrases — all 10 correct (see ADR-005 for the rules).

**Follow-up fixes (Sept 25–28):**
- Reminders that name no task ("remind me in 5 minutes") are labelled "Reminder" instead of being rejected as malformed.
- The user's app still showed "key rejected" after they updated `apps/api/.env` — the packaged app never reads `.env`; its key lives in `%APPDATA%@ai-agentdesktopconfig.json` (was last written Sept 18). Fixed by the user re-saving the key in Settings.
- **The built-in default Groq model `qwen/qwen3-32b` was retired by Groq (404 model_not_found).** Dev kept working only because `.env` sets `GROQ_MODEL=qwen/qwen3.8-27b`; the packaged app has no override, so every Groq call (reminder parsing *and* Check now's AI prioritization) failed there, shown as "busy". Default switched to `qwen/qwen3.8-27b`; 404 now maps to a distinct `model_unavailable` kind/message (no retry). Live-verified with `GROQ_MODEL` unset. Lesson: test with the packaged app's env, not dev's.

- **Reminders not popping up automatically (Sept 28):** not a stopped scheduler — the app process (started 12:53:08) was verified syncing on schedule (DB write at 13:08:17). An earlier claim that the timers had stopped was wrong: each Email row keeps only its *latest* `updatedAt`, so a manual sync overwrites evidence of earlier scheduled ones — don't infer sync history from that column. Real cause was latency: 60s delivery tick + 15s renderer poll (due 13:03:34, next tick 13:04:16, user clicked at 13:04:08). Fix: 15s delivery tick + `inbox:changed` push from the scheduler to the renderer (`onTickComplete` → preload `onInboxChanged` → `use-intervention-polling`).
- Groq errors now carry a safe diagnostic (`HTTP 429 rate_limit_exceeded`, `network error`) appended to the on-screen message — the packaged app has no log file, so this is the only way to see why Groq refused.

- **Dock redesign + reminders moved out of Settings (Sept 28):** the idle affordances are one bottom-right pill (`Dock.tsx`): ⚙ | 🎤 💬 | ↻ Check now | "3m ago". 💬 opens a compact text box above the dock (`ReminderComposer.tsx`, Enter submits, Esc closes); 🎤 records straight from the dock with a status bubble. Logic lives in `state/use-reminder-composer.ts` + `lib/reminder-results.ts`; Settings no longer has an "Add a reminder" section. Window min height 80 → 48 so idle is just the pill.
- **Groq free-tier OTPM limit (open, awaiting user go-ahead):** `qwen/qwen3.8-27b` now rejects every request with `HTTP 429 rate_limit_exceeded` — "output tokens per minute: Limit 1000, Requested 2048". Groq reserves the default max output (2048) up front; we never set `max_completion_tokens`. Proposed fix: cap it per request (~300 for reminder parsing), skip the automatic retry on this 429, clearer message. Until then reminders (and Check now's AI step) fail.

**Open:** rebuild the `.exe` when the user asks; user retest of voice + typed reminders; the dev `apps/api/.env` key was updated by the user (works). Calendar events created <5 min before start may alert late (documented limitation).

---

## Addendum: Background sync, tray, reminders (text + voice), and a UI redesign (September 18–24, 2026)

**This addendum covers several sessions of work in one continuous stretch — not yet split into formal sub-phases.** Everything below is implemented, tested (typecheck/lint/vitest, 542 API tests / 118 desktop tests, all green), and verified live where a real Electron launch or a real Groq API call could confirm it. **None of it is committed to git** (still sitting on top of the `b2b2f5a` checkpoint commit — see "Housekeeping" below) and **the most recent two bug fixes are not yet in a packaged `.exe`.**

### What shipped, roughly in the order it was built

1. **Character-right / message-left intervention redesign.** New `InterventionOverlay`/`InterventionMessage`/`InterventionActions`/`InterventionStatus` components replace the old stacked `Character`+`InterventionCard`. Matches a reference mockup the user supplied: character on the right, message bubble + action buttons on the left, entrance/idle animation, data-driven action buttons (not hardcoded per intervention).
2. **Window auto-sizing to content** (`overlay-window.ts`'s `resizeOverlayToContent`, `use-report-content-size.ts`). The window used to be a fixed 380×540 — always mouse-interactive (Phase 4.7), so its whole rectangle blocked clicks to the desktop regardless of how little content was actually showing. Now it resizes to match real rendered content, verified live via Win32 `GetWindowRect` showing exact `workArea - 24px margin` anchoring.
3. **Continuous background sync** (`sync-scheduler.ts`), replacing the need to click "Check now" — runs the same sequence automatically every 15 minutes (`DESKTOP_SYNC_INTERVAL_MINUTES`, clamped 5–30). The manual button/tray item still work for on-demand checks.
4. **System tray icon** (`tray-icon.ts` — a hand-built 32×32 PNG, no asset file needed) with **Check now**, **Pause notifications** (30 min / 1 hour / 4 hours, `pause-state.ts`), and **Quit** — the only way to close the app before this existed was Task Manager.
5. **Google auth-expiry detection**: a 401/403 from any sync call now flips a reactive `googleAuthError` flag (`index.ts`'s `performCheckNow` wrapper around every check path). Surfaced as a small red-dot badge on the settings gear (non-blocking) plus a "Reconnect Google" flow in Settings.
6. **"Last checked" indicator** — small corner text, relative time, updated by every check path (scheduled, manual, tray).
7. **Broadened email detection** (`actionable-email.detector.ts`): previously only emails matching specific keyword phrases ("can you", "waiting for your response", etc.) were surfaced at all — most ordinary email was silently dropped. Now every unread, non-automated, in-window email is surfaced (`matchedRules: ["new_email"]`, title "New email from X"), explicit-request language still gets the higher "high" tier. Documented trade-off: first sync after connecting can surface up to 14 days of backlog at once (no "first seen" tracking exists).
8. **Reminders — the largest piece.** New `Reminder` Prisma model + migration, reusing the existing Signal→Intervention pipeline exactly like Gmail/Calendar do (`reminder-detection.service.ts`). Three creation paths:
   - `POST /reminders` — exact date/time (Settings picker), fires exactly then.
   - `POST /reminders/from-text` — free text ("remind me to drink water at 4pm") parsed by Groq (`reminder-parsing.service.ts`, `reminder-parse-prompt.ts`) into `{reminderText, eventAt, leadMinutes}` — fires `leadMinutes` (default 10, model can infer a different value from phrasing) *before* the deadline, mirroring how calendar reminders already work, not at the deadline itself. Verified live against the user's own three example phrases (4pm→3:50pm, 5pm→4:50pm, and an explicit future date) — all correct.
   - `POST /reminders/from-voice` — a recorded clip (base64 JSON, no multipart dependency added), transcribed by Groq Whisper (`groq-client.ts`'s new `transcribeAudio`, `audio-transcription.service.ts`), then run through the exact same text-parsing path. One round trip, no "review before it submits" step (deliberate, per the user's "just talk and it schedules" ask).
9. **Voice UI**: 🎤 button in Settings next to the reminder input (`voice-recorder.ts` — thin `getUserMedia`/`MediaRecorder` wrapper, 20s auto-stop safety cap). Required a new Electron-level microphone permission handler (`index.ts`'s `session.defaultSession.setPermissionRequestHandler`) — without it, `getUserMedia` fails silently with no OS prompt at all. The OS's own mic privacy setting (Windows Settings → Privacy → Microphone) is a separate gate this can't do anything about.
10. **Two bugs found by the user's own packaged-`.exe` testing, fixed in source:**
    - **Settings content silently clipped, unreachable/unclickable below the fold** (screenshot showed the "Add a reminder" section's mic button and Add button simply not there). Root cause: `resizeOverlayToContent`'s `MAX_HEIGHT_RATIO` cap (0.85 of the work area) could be shorter than Settings' actual content once the reminder section was added, and content taller than the window is genuinely clipped by `overflow:hidden`, not just visually cut off. Fixed properly: `.settings-card` now has `max-height: 480px; overflow-y: auto` so it's *never* dependent on the window being allowed to grow enough — the window resize cap (bumped to 0.92 too, as a backstop) is no longer load-bearing for reachability. Verified live in the browser pane at a constrained 650px viewport height — scrollbar appears, every control reachable.
    - **A persistent "All caught up" box sitting on the desktop at all times** — this was a direct, never-implemented piece of the user's original vision ("it should disappear... not be available all the time"). Fixed: the empty/idle state now renders no card at all, just the small corner affordances (settings gear, Check now link, last-checked text) — the window shrinks to match via the existing content-resize logic. Verified live: `get_page_text` on the idle state now returns only `⚙ Check now Last checked 3m ago`, no "All caught up" text anywhere.

### Housekeeping — read this first in the next session

- **Nothing from this whole stretch is committed.** `git status` shows ~60 modified/new files on top of commit `b2b2f5a` ("Checkpoint: Phase 2 through Phase 4.7"). No secrets/`.env`/`dev.db` are among them (checked).
- **The packaged `.exe` is stale relative to source.** `apps/desktop/release/AI Executive Agent Setup 0.1.0.exe` was last built before the two bug fixes above (item 10) — it still has both bugs the user just reported. **Rebuilding (`npm run package:win` from `apps/desktop`) is the first thing to do in the next session**, before anything else, so the user can actually retest against fixed code. A rebuild was in progress when this session ended and got interrupted (not a failure — just cut off to do this handoff instead).
- **Env vars added this stretch**: `DESKTOP_SYNC_INTERVAL_MINUTES` (desktop), `GROQ_TRANSCRIBE_MODEL` (api, optional — defaults to `whisper-large-v3-turbo`). Neither needs to be set for normal use.
- **A real Groq key is present in this dev machine's `apps/api/.env`** — this is what made live verification of reminder parsing and voice transcription possible without the user's involvement. Don't assume this exists on other machines.

### What's still open (not done this stretch, not forgotten)

- **Rebuild + user retest of the `.exe`** — see Housekeeping above, this is the immediate next step.
- **Commit this work to git** — the user hasn't asked for this yet; ask before doing it, per the checkpoint-commit precedent earlier in this project.
- **No delete-reminder UI** — `DELETE /reminders/:id` exists and is tested, but Settings has no way to list/remove an existing reminder. If you create one by mistake, it fires once and you Done/Remind-later it away like any other intervention.
- **Reminders are gated behind Google being connected** — they ride inside the same `checkNow()` sequence as Gmail/Calendar in the scheduler; documented as a known, low-impact trade-off in `api-client.ts` (by the time reminders are usable at all, Google is already required to be connected).
- **No "review the transcript before it submits" step for voice** — deliberate per the user's ask; worth revisiting if misheard speech turns out to be annoying in practice (their own next real-world test will tell).
- **The broader "personal assistant" discussion** (agentic tool-calling, a memory/notes layer using `sqlite-vec`, Obsidian-style plain-text storage philosophy) was a deep research + planning conversation, not implemented — reminders was the one concrete piece pulled out of it and built. The rest is still just a plan, written up in this session's chat history, not in any doc yet. Worth writing up properly in a docs file if it's still the direction, since it currently only exists in conversation.
- **Everything already open from Phase 4.7** is still open: genuine clean-machine install test, Done/Snooze/Open against real non-demo data, Google disconnect/reconnect untested, the unresolved data-loss episode, no code signing/custom icon.

---

## Addendum: Phase 4.7 continued - Onboarding, Manual Sync, and Real Google OAuth (September 18, 2026)

**Full detail in `docs/ONBOARDING_AND_MANUAL_SYNC.md` — this is a summary
for the handoff record. Read the full doc before starting new work in this
area; it has the reasoning behind several non-obvious decisions.**

What happened, in order: the user's first real click-through of the
Phase 4.7-packaged app (installed fresh, no dev environment) found it
completely unusable — invisible window, then unclickable, then no way to
configure Google OAuth at all, then a broken database, then a missing
character image. Each was a real, distinct bug, found and fixed in
sequence, verified together. The session then grew into building what the
user had actually asked for from the start: a real onboarding screen
(Groq key + Google connect, shown automatically, not hidden behind a gear
icon), a manual "Check now" button (sync + evaluate on demand, since
automatic polling doesn't exist yet), and paging through multiple pending
interventions instead of only ever showing one.

**Bugs found and fixed (numbered 5–7, continuing Phase 4.7's list):**
5. The overlay window was click-through in every state except "has an
   intervention" — `setInteractive` was never wired to any other screen,
   so Settings/onboarding/the empty state were all genuinely unclickable,
   not just visually unresponsive. Fixed by making the window interactive
   unconditionally on mount, since every screen now has real clickable
   content.
6. `DATABASE_URL` was never actually set for the packaged app's own main
   process — only the separate migration child process got it explicitly.
   Invisible until the new `ensureDemoUser` bootstrap became the first
   thing to make the embedded server touch Prisma at startup. Fixed with
   an absolute, `userData`-rooted path set on `process.env` before
   anything needs it.
7. The character image (`Character.tsx`) used an absolute
   `src="/character.svg"`, which the earlier blank-window fix
   (`vite.config.ts`'s `base: "./"`) couldn't reach — that fix only
   rewrites paths Vite itself generates, not hand-written JSX string
   literals. Fixed with a relative path. Also fixed the `alt` text that
   had been a "pre-existing, unrelated" failing test since Phase 2.1 —
   the full desktop suite is genuinely all-green for the first time.

**A real architectural gap, not a bug — closed this session:** the app is
single-user, and every route needs one bootstrap `User` row to exist
before anything (including "Connect Google" itself) works. That row used
to only be created by a manual seed script nobody runs in the packaged
app. New `ensureDemoUser`, run on every API server start via a Fastify
`onReady` hook, idempotent, closes this permanently.

**A real product decision, not a bug:** Google OAuth needed two separate
fixes to work from a packaged install — a fixed port (4000, matching the
project's existing, already-real-world-tested OAuth client's registered
redirect URI, since Phase 4.2's dynamic port can't match a fixed
registration), and new Settings UI fields for Client ID/Secret. The
credentials were deliberately **not** baked into source/the distributed
binary, even though the project already has working ones — this
specific client looks like a "Web application"-type registration, whose
secret Google treats as genuinely confidential (unlike a "Desktop
app"-type client's secret, which Google's own model expects to ship
inside distributed apps — see the Phase 4.3 addendum further below, which
investigated this exact distinction). Same safeStorage-encrypted,
per-machine, never-in-source pattern as the Groq key.

**An open question, honestly unresolved:** partway through, a check found
the database completely empty (just the bootstrap user, no Google
connection, no synced data) despite the user having successfully
connected minutes earlier. The user simply repeated the connect +
check-now flow and it worked again — but the root cause of that apparent
data loss was never identified. See `docs/ONBOARDING_AND_MANUAL_SYNC.md`'s
"open question" section for what was and wasn't ruled out.

**Real (user-verified, not agent-simulated) end-to-end confirmation:**
fresh install → Settings shows both new credential sections → Groq key +
Google Client ID/Secret saved → "Sign in with Google" opened a real
consent screen → completed with the user's real account → "Check now" →
a real calendar event ("Important Meeting & discussion", 18 minutes out)
came back as a correctly-styled `MEDIUM`-priority intervention, character
visible, Open/Done/Remind-me-later buttons all present. Confirmed via a
screenshot from the user, not an agent-side check.

**Docs updated:** new `docs/ONBOARDING_AND_MANUAL_SYNC.md`;
`CURRENT_STATUS.md`, `docs/IMPLEMENTATION_CHECKLIST.md`.

**Tests/results:** new `overlay-window.test.ts` (2), `Character.test.tsx`
(1), `demo-user-bootstrap.api.test.ts` (3, `apps/api`); `App.test.tsx`
grew substantially (window interactivity, first-run setup, Check now,
multi-intervention paging). Full desktop suite: **65/65** — genuinely all
green, not "all green except one pre-existing unrelated failure" for the
first time this project has had that. Full `apps/api` suite: 467/467
(a pre-existing, documented flake in `assistant-evaluate.api.test.ts` —
a hook timeout under full-suite load — recurred once during final
verification; passes cleanly every time run standalone, and has been a
known intermittent issue since Phase 2.7, not something introduced this
session).
Typecheck/lint clean across both workspaces.

**Not done — carried forward to the next session:** the actual point of
Phase 4.7 (a machine that's never had this repo's dev tooling on it —
everything above was still on the same dev machine); continuous/scheduled
sync (the user's own stated next step, now that manual sync is proven);
the unresolved data-loss episode; Done/Snooze/Open buttons not yet
click-tested by the user against real (non-demo) data; Google
disconnect/reconnect not exercised; no systematic check for other
hand-written absolute asset paths elsewhere in the renderer (Bug 7 was
found by testing, not an audit); no code signing certificate, no custom
app icon (unchanged from Phase 4.6).

---

## Addendum: Phase 4.7 - Clean-Install Validation, in progress (September 17, 2026)

Full detail in `docs/WINDOWS_PACKAGING.md`'s Phase 4.7 section — summary
for the handoff record. **This phase is not complete** — everything below
was verified on the machine that built the installer; the actual
clean-machine test is still outstanding.

**Static checks first, and they ruled out the biggest suspected risk:**
scanned the native Prisma query engine DLL and the main `.exe` for their
DLL import tables (crude but effective: `grep -aoE` for `.dll` strings
over the raw binaries, since no `dumpbin`/`objdump` was available). Both
reference only standard Windows system DLLs — no Visual C++
Redistributable dependency at all, for either the Rust-built Prisma engine
or Electron itself.

**Then a real install immediately surfaced a genuine bug the build log
never hinted at:** the installed app was missing `resources/api/prisma/`
entirely — the DB schema and migrations. Isolated precisely by listing
and then directly extracting the installer's own embedded archive with
7-Zip: the archive has the files, byte-correct. Only NSIS's own generated
installer, actually *run*, fails to write that one folder to `$INSTDIR`.
Fixed by keeping the schema at two locations — the conventional
`resources/api/prisma/` (needed at build time by `@prisma/client`'s own
`prisma generate` step) and a nested `resources/api/dist/prisma/` copy
that's proven to survive installation, with `migrate.ts` preferring the
former (dev) and falling back to the latter (packaged).

**Two more bugs, found in under 10 seconds each instead of a multi-minute
install cycle:** rather than keep going through full rebuild → install →
wait-for-NSIS-extraction → launch cycles (each several minutes,
dominated by `npm install` and NSIS's own extraction time) to test each
hypothesis, later bugs were reproduced by writing a tiny throwaway script
that imports the compiled `runMigrations()`/`startEmbeddedApiServer()`
directly and points them at the real `resources/api` folder — no
Electron, no installer, no waiting. This caught: (1) `prepare-api-
resources.mjs` itself placing `node_modules/@ai-agent/shared` *before*
running `npm install`, which prunes anything under `node_modules/` not
declared in `package.json` — silently losing it on every single run,
purely this project's own script bug, nothing to do with NSIS or
electron-builder; (2) a direct side effect of the first fix — moving the
schema *only* under `dist/prisma/` broke `@prisma/client`'s own
postinstall, which looks for the schema at the conventional path,
resolved by keeping both copies as described above.

**A fourth bug — and the most important one, since it was found by the
user's own real test, not by anything I checked from a terminal:** after
all three bugs above were fixed and every API-level check passed, the
user installed and ran the actual `.exe` themselves — exactly what this
phase exists for — and reported the process showing as running in Task
Manager with **no window visible at all**, not even blank. Root cause:
`overlay-window.ts` resolved the renderer's `index.html` path one
directory level short (`dist/main/renderer/index.html`, which doesn't
exist) instead of the real location (`dist/renderer/index.html`, a
sibling of `dist/main/`, not nested inside it) — confirmed directly by
listing the packaged `app.asar`'s actual contents. A failed `loadFile()`
never fires `ready-to-show`, which is what the window's `.show()` call
was gated on, and the window was created with `show: false` — so it's a
real Electron process with a genuinely, permanently invisible window, not
a rendering glitch. **This bug had been there since the overlay window
was first written (Phase 1) and survived every dev-mode test in every
phase since**, because dev mode loads the Vite dev server URL directly
and never exercises this file-path code at all — it only manifests in a
packaged build, and only shows up as "no visible window," which nothing
short of a human actually looking at the screen would catch. My own
extensive packaged-app checks earlier in this very session (Phase 4.6 and
the rest of 4.7) never caught it either, because I was checking the
window's *existence* (`Get-Process`, non-empty `MainWindowHandle`/
`MainWindowTitle`) and the embedded API's health — never whether the
renderer's actual page content loaded. In hindsight, the window titles I
saw in those earlier checks (`@ai-agent/desktop`, the `package.json`
name) were Electron's own fallback, never updated to the HTML's real
`<title>AI Executive Agent Desktop</title>` — a page that never loaded
can't set its own title. That's also how the fix was confirmed without a
screenshot: after fixing the path, the same title check now reads
`AI Executive Agent Desktop`, direct evidence the page genuinely
rendered this time. Fixed with the correct two-levels-up path, plus a new
`overlay-window.test.ts` (mocking `electron`) asserting the resolved path
ends in `/renderer/index.html` and never contains `/main/renderer/` —
the only thing in the test suite now capable of catching this exact
regression, since dev-mode testing structurally can't reach this code
path at all.

**An honest note on something observed but not fully chased down:**
running the identical installer `.exe` repeatedly in quick succession (as
this validation pass necessarily did, many times) produced inconsistent
results across separate runs — total extracted file counts varied, and
one run left large parts of the app missing despite the installer process
reporting a clean exit. This doesn't look like a packaging defect (the
three bugs above were each reproduced consistently and are now fixed) —
it looks like real-time antivirus scanning (Windows Defender, confirmed
active on this machine) racing with NSIS's extraction of several thousand
small files. Not chased further, since a real user runs an installer
once, not ten times in a row for testing purposes — but worth knowing:
if the app doesn't start after a fresh install, re-running the installer
is a reasonable first troubleshooting step.

**Real (non-mocked) verification after all three fixes:** a clean install
(prior install directory + registry uninstall entry removed first),
waited for the *actual* extraction to finish (polling installed file
count until it stopped growing — a bare "has the installer process
exited" check proved unreliable, per the flakiness note above), confirmed
both fixed paths present on disk, launched `AI Executive Agent.exe`
directly from its real per-user install path
(`%LOCALAPPDATA%\Programs\AI Executive Agent`, no elevation needed),
confirmed the embedded API bound a real dynamic port and
`GET /api/v1/health` responded `200`, and confirmed closing the app
released the process and the port cleanly.

**Docs updated:** `docs/WINDOWS_PACKAGING.md` (new Phase 4.7 section),
`CURRENT_STATUS.md`, `docs/IMPLEMENTATION_CHECKLIST.md`.

**Tests/results:** new `overlay-window.test.ts` (2 tests, bug 4's
regression guard). The other three fixes live in
`scripts/prepare-api-resources.mjs` (a build-time script) and a small
fallback-path addition to `migrate.ts`'s existing, already-tested schema
resolution — no new tests needed there. Full desktop suite: 49/50 (same
pre-existing, unrelated Phase 2.1 failure). Typecheck/lint clean.

**Not done — genuinely this phase's whole point:** running the installer
on a machine that never had this repo's dev environment on it. The DLL
dependency check is the strongest evidence so far that a clean machine
will work, but it isn't a substitute for actually trying it on one.

---

## Addendum: Phase 4.6 - Windows Packaging via electron-builder (September 17, 2026)

Full detail in `docs/WINDOWS_PACKAGING.md` — summary for the handoff record.

**What changed:** the desktop app now builds into a real, standalone
Windows artifact via `electron-builder` — `npm run package:win` (from
`apps/desktop`) produces an NSIS installer
(`AI Executive Agent Setup 0.1.0.exe`, ~151 MB) plus an unpacked
`release/win-unpacked/` build, neither of which needs the monorepo, pnpm,
or a dev server present to run. This is the first phase where the app
leaves this machine's development environment in any real sense.

**The core problem, found and solved, not assumed away:** the embedded
API (Phase 4.2) and auto-migration (Phase 4.5) both need a real, on-disk
`@ai-agent/api` — compiled `dist/`, its Prisma schema/migrations, and a
working `node_modules`. `apps/api`'s own `node_modules`, like every pnpm
workspace package's, is a tree of symlinks/junctions into pnpm's shared
store — copying it elsewhere (as packaging does) leaves dangling links.
**`pnpm deploy` was tried first and rejected for a concrete, verified
reason, not a hunch**: it produces its own internal virtual store, but on
Windows that store uses *absolute* junctions — confirmed directly via
`Get-Item ... | Select LinkType, Target` on a real `pnpm deploy` output —
which break the same way once the deployed folder is moved off the
machine that built it (exactly what packaging does). New
`scripts/prepare-api-resources.mjs` sidesteps pnpm's linking entirely:
copies `apps/api`/`packages/shared`'s compiled output directly (real
files, no symlinks), then runs a **plain `npm install --omit=dev`**
(deliberately not pnpm) for the registry-published runtime deps —
producing an ordinary, fully real, relocatable `node_modules`, verified
directly (not assumed) via PowerShell showing `@prisma/client` as a real
directory with `LinkType` empty, and the native
`query_engine-windows.dll.node` present and correctly generated for this
platform.

**A resolver refactor this required, not a bolt-on:** new
`api-location.ts`'s `resolveApiRoot({ isPackaged, resourcesPath })` is now
the single source of truth for where `@ai-agent/api` lives — dev's
monorepo sibling, or (packaged) `resourcesPath/api` — computed once in
`index.ts` and passed into both `runMigrations()` (Phase 4.5) and
`startEmbeddedApiServer()` (Phase 4.2), which previously each made their
own dev-only assumptions. `api-server.ts` now imports
`<apiRoot>/dist/app.js` by absolute file URL instead of the bare
`"@ai-agent/api"` package specifier, which only ever resolved via
node_modules and is meaningless for a packaged app's standalone
`resources/api` copy.

**A second real bug caught only by inspecting actual packaged output, not
the build log succeeding:** electron-builder's `extraResources` silently
drops any directory literally named `node_modules` from what it copies —
confirmed by listing the packaged output after a real build and finding
`dist/`, `prisma/`, and `package.json` all present, `node_modules`
nowhere. An explicit `filter: ["**/*"]` override, which per
electron-builder's own docs should replace the default filter, made no
difference. Fixed with an `afterPack` hook
(`scripts/after-pack.cjs`) that plainly `fs.cpSync`s
`resources/api/node_modules` into the packaged app once electron-builder
is done — the source is already fully real (from the plain `npm install`
above), so a straightforward recursive copy is correct.

**Dependency cleanup, not just packaging plumbing:** `apps/desktop
/package.json` no longer depends on `@ai-agent/api` (no longer imported by
specifier); `@ai-agent/shared`, `react`, and `react-dom` moved to
`devDependencies` (all three are renderer-only, already inlined into
static assets by vite at build time — never needed in the packaged app's
own `node_modules`). The packaged app's main process now has exactly one
real npm runtime dependency: `dotenv`.

**Real (non-mocked) verification, five parts, escalating in scope:**
1. Inspected `prepare-api-resources.mjs`'s own output directly — confirmed
   via PowerShell that `@prisma/client` is a real directory, not a
   symlink, directly falsifying the naive "just copy `apps/api
   /node_modules`" approach this script replaces.
2. Pointed the compiled `runMigrations()`/`startEmbeddedApiServer()` at
   `resources/api` directly under **plain Node**, before touching
   electron-builder at all — confirmed migrations ran against a fresh
   database and the API answered a real `GET /api/v1/health`, fully
   decoupled from the packaging step.
3. Launched the actual `--win dir` unpacked build **twice**. The first
   launch attempt, before the `afterPack` fix, would have crashed on a
   missing `@prisma/client` — caught specifically *because* the packaged
   `.exe` was actually launched, not because the build log showed an
   error (it didn't; packaging itself "succeeded"). After the fix: deleted
   any leftover `dev.db` to simulate a genuine first install, launched
   `AI Executive Agent.exe` directly (no `npx electron .`, no monorepo
   context at all), confirmed a fresh `dev.db` was created (migrations
   ran), confirmed the embedded API bound a real dynamic port and
   `GET /api/v1/health` responded `200`, confirmed a real window (non-empty
   `MainWindowTitle`), and confirmed closing the app released the process
   and the port.
4. Reran the **entire pipeline from a clean slate**
   (`rm -rf release resources`, then the single `npm run package:win:dir`
   command) and repeated the same launch verification — confirming the
   build is reproducible, not a one-off that happened to work after manual
   fiddling.
5. Built the actual **NSIS installer** (`npm run package:win`) —
   succeeded, produced a real ~151 MB `.exe`. **Deliberately did not run
   the installer itself** — installing software system-wide (registry
   entries, Start Menu, a real install location) is a meaningfully more
   invasive, harder-to-reverse action than inspecting and launching a
   `--dir` build in place, and wasn't done without the user present to
   decide whether to install it onto their own machine. The `win-unpacked`
   verification above already exercises the exact same packaged bits the
   installer wraps.

**Docs updated:** new `docs/WINDOWS_PACKAGING.md`; `CURRENT_STATUS.md`,
`docs/IMPLEMENTATION_CHECKLIST.md`.

**Tests/results:** new `api-location.test.ts` (2 tests); `api-server.test.ts`
and `migrate.test.ts` updated for the new `apiRoot`-based signatures (12
tests total across the three files). Full desktop suite: **47/48** (the 1
failure is the same pre-existing, unrelated Phase 2.1 alt-text mismatch).
Typecheck clean. Lint clean — including a genuine fix along the way (not
just matching an existing pattern): added a `.cjs`-scoped eslint override
for `@typescript-eslint/no-require-imports`, since both the new
`after-pack.cjs` and the pre-existing (previously lint-failing)
`preload.cjs` legitimately need `require()` — both exist specifically
because something outside this package's own control (Electron's preload
sandbox, electron-builder's hook loader) requires plain CommonJS inside an
otherwise `"type": "module"` package.

**Not yet done (later Phase 4 sub-phases):** no code signing certificate
(the build log's `signing with signtool.exe` step ran but produced
unsigned binaries — no real cert is configured on this machine; Windows
SmartScreen will warn on first run), no custom app icon (electron-builder
falls back to its own default), no auto-update mechanism, and — most
importantly — **no clean-install validation on a machine that never had
this repo's dev environment on it**, which is explicitly Phase 4.7's job.
Everything verified above was on the same machine that built the package.

---

## Addendum: Phase 4.5 - Auto-Run Prisma Migrations on First Launch (September 17, 2026)

Full detail in `docs/AUTO_MIGRATIONS.md` — summary for the handoff record.

**What changed:** `apps/desktop/src/main/migrate.ts`'s new `runMigrations()`
shells out to `prisma migrate deploy` (not `migrate dev` — no prompts, no
shadow database, only applies already-committed migration files) against
`apps/api/prisma/schema.prisma`, and `index.ts` calls it in
`app.whenReady()` immediately before `startEmbeddedApiServer()` (Phase
4.2), inside the same `try/catch` — a migration failure surfaces through
the exact same in-app startup-error screen Phase 4.3 already built, no new
error UI needed. A fresh clone/install no longer needs a manual
`pnpm db:migrate` step before the desktop app works. Runs on every launch,
not gated behind a "first launch" flag, deliberately: `migrate deploy` is
idempotent (a no-op once the schema is current), so running it
unconditionally is simpler than tracking that flag and self-heals if a
future update ships a new migration. `prisma` moved from a devDependency to
a regular dependency of `apps/api`, since the desktop app now needs to
resolve and run its CLI at runtime, not just during development.

**A real bug this phase would have shipped with, caught only by an actual
Electron launch — not by unit tests, not by a direct Node smoke test:**
the first implementation spawned the prisma CLI via
`spawn(process.execPath, [prismaCliPath, ...])`, which is correct under
plain Node but wrong inside Electron's main process, where
`process.execPath` is `electron.exe`, not `node.exe`. Without
`ELECTRON_RUN_AS_NODE=1`, that spawn tries to launch another Electron app
instead of running the script — the embedded API never started, and the
overlay window never appeared (every Electron process reported a
`MainWindowHandle` of `0`). This passed both the mocked unit tests (which
inject `spawnFn` and never touch the real `process.execPath`) and an
initial direct `node dist/main/migrate.js` smoke test (which runs under
plain Node, not Electron) — it only surfaced when Electron was actually
launched for real (`npx electron .`) as part of this phase's own
verification step. Fixed by adding `ELECTRON_RUN_AS_NODE: "1"` to the
spawned child's environment (a no-op when `process.execPath` is already
plain Node).

**Why a relative path to locate `apps/api/prisma/schema.prisma`, not
package resolution:** `@ai-agent/api`'s `package.json` has an `"exports"`
map with only an `"import"` condition, so neither
`require.resolve("@ai-agent/api/...")` (fails outright — no `"require"`
condition) nor `import.meta.resolve("@ai-agent/api")` (works under real
Node/Electron, but unimplemented under Vitest's Vite-SSR test transform,
breaking the unit tests) could locate it reliably in both the runtime and
the test environment. Instead, `migrate.ts` walks up from its own
`import.meta.url` — this file always lives at
`apps/desktop/{src,dist}/main/migrate.{ts,js}`, and `apps/api` is always
its sibling under `apps/` in this monorepo layout, true in dev and in the
current (unpackaged) build alike, guarded by an `existsSync` check so a
broken assumption fails with a clear error rather than a confusing spawn
failure. Documented in `docs/AUTO_MIGRATIONS.md` as something to revisit
if Phase 4.6 packaging changes that on-disk layout.

**Real (non-mocked) verification, in two parts:**
1. Backed up and deleted the real `apps/api/prisma/dev.db` to simulate a
   fresh install, then ran the compiled `runMigrations()` directly against
   it — confirmed via a direct Prisma Client query (not just "the file
   exists") that a fresh SQLite file was created with all 9 expected
   tables, including `_prisma_migrations`. Ran it a second time against the
   same database and confirmed the idempotent no-op path completes
   cleanly. Restored the original `dev.db` (with its existing demo data)
   afterward — this phase never touched the real dev database's contents.
2. Launched actual Electron (`npx electron .`, real Vite dev server)
   twice. The first attempt, before the `ELECTRON_RUN_AS_NODE` fix, hung
   indefinitely with no window and no bound port — this is what caught the
   bug above. After the fix, a second real launch: the embedded API bound
   a genuine dynamic port (`64182` in the test run), `GET /api/v1/health`
   and `GET /api/v1/interventions` both responded correctly through it,
   and the Electron process reported a real non-zero window handle
   (unlike the hung attempt). Closed the window and confirmed via
   `Get-NetTCPConnection` that all Electron processes exited and the port
   was released.

**Docs updated:** new `docs/AUTO_MIGRATIONS.md`; `CURRENT_STATUS.md`,
`docs/IMPLEMENTATION_CHECKLIST.md`.

**Tests/results:** 5 new tests in `migrate.test.ts` (CLI invocation shape
including the `ELECTRON_RUN_AS_NODE` env var, `DATABASE_URL` fallback
chain, success including the "no pending migrations" case, failure with
captured CLI output, spawn-failure). Full desktop suite: **44/45** (the 1
failure is the same pre-existing, unrelated Phase 2.1 alt-text mismatch).
`apps/api` untouched this phase (only its `package.json`'s dependency
classification changed — no `src` changes). Typecheck/lint clean.

**Not yet done (later Phase 4 sub-phases):** no Windows packaging. The
relative sibling-path assumption this phase relies on, and whether
`prisma`'s CLI (and its native query-engine binaries) survive being
bundled by `electron-builder`, are both open questions left for Phase 4.6,
not resolved here.

---

## Addendum: Phase 4.4 - Secrets & Config Storage (September 16, 2026)

Full detail in `docs/SECRETS_STORAGE.md` — summary for the handoff record.

**What changed:** `app-config.ts` upgraded from Phase 4.3's plain-JSON
storage to Electron's `safeStorage` (OS keychain — DPAPI on this machine,
Keychain on Mac, libsecret on Linux) for both the Groq key and a new
second secret: `ENCRYPTION_KEY` (the AES key `apps/api`'s `crypto.ts` uses
for Google refresh tokens). `ENCRYPTION_KEY` is now auto-generated on
first launch if nothing else provides one — the manual
`openssl rand -base64 32` step is gone for anyone running the desktop app.
`safeStorage` is injected via a `SafeStorageLike` interface rather than
imported directly, keeping the module unit-testable without Electron
running.

**The precedence logic for `ENCRYPTION_KEY` got real thought, not just "generate
one":** getting this wrong would silently make previously-encrypted Google
refresh tokens undecryptable. Order: (1) already in the encrypted store —
use it, never regenerate; (2) present in `.env` (still the normal path for
`apps/api` run standalone, outside Electron) — use it and persist it into
the store so the app works even without `.env` later; (3) neither —
generate and persist a fresh one. The Groq key keeps Phase 4.3's simpler
rule (Settings UI always wins over `.env`) since there's no
already-encrypted-data risk there.

**Backward compatible with Phase 4.3's plaintext file** — read once,
auto-upgraded to the encrypted format on the next save. No manual
migration, no data loss (verified: there was, in fact, no
Phase-4.3-created `config.json` on this machine yet — nobody had actually
saved a Groq key through the UI in prior testing, since Phase 4.3's
"real verification" was Electron not crashing, not a live click-through).

**Honest, not silent, about the failure mode**: if
`safeStorage.isEncryptionAvailable()` is `false` (some Linux setups with
no keyring), the app still works — stores plain base64 rather than
refusing — but the Settings screen shows an explicit warning instead of
quietly claiming encryption that isn't happening.

**Real (non-mocked) verification, twice, with a meaningful check between
them:** launched Electron against the real dev database, twice in a row.
First launch: confirmed `config.json` was created with `"secure": true`
and a genuinely non-human-readable encrypted value (not just base64
obfuscation — real DPAPI encryption). Second launch: confirmed the file's
content hash was **byte-for-byte identical** to the first — proving the
key is not silently regenerated on every startup, which would be a subtle
and very bad bug (every restart would orphan any already-encrypted
tokens). Both launches: the embedded API started successfully and
`GET /integrations/google/status` responded `200` with real data,
confirming the generated key actually round-trips through `crypto.ts`'s
own 32-byte format validation, not just "looks like a key."

**Docs updated:** new `docs/SECRETS_STORAGE.md`; `docs/ONBOARDING_SETTINGS.md`'s
"interim storage" section marked as resolved rather than rewritten (kept
as a historical record of the Phase 4.3 scoping decision);
`CURRENT_STATUS.md`, `docs/IMPLEMENTATION_CHECKLIST.md`.

**Tests/results:** 14 new tests in `app-config.test.ts`, 1 new
`App.test.tsx` test (secure-storage warning banner). Full desktop suite:
**39/40** (the 1 failure is the same pre-existing, unrelated Phase 2.1
alt-text mismatch). `apps/api` untouched this phase. Typecheck/lint clean.

**Not yet done (later Phase 4 sub-phases):** no auto-migration on first
launch, no Windows packaging. This phase specifically only hardened *how*
secrets are stored — nothing about *what* still needs manual setup (running
`pnpm db:migrate` yourself) changed.

---

## Addendum: Phase 4.3 - Onboarding & Settings UI (September 16, 2026)

Full detail in `docs/ONBOARDING_SETTINGS.md` — summary for the handoff
record.

**What changed:** a real Settings screen (gear toggle, top-left of the
overlay) — Groq API key status/input/save, Google connection status with
Sign-in/Disconnect buttons — plus an in-app startup-error screen replacing
Phase 4.2's native `dialog.showErrorBox` + `app.quit()`. No new API routes
were needed for Google status/disconnect — both already existed from
Phase 2.1; only two new `ApiClient` methods were added to call them.

**A real design constraint surfaced and handled explicitly, not glossed
over:** the embedded API (Phase 4.2) is loaded via `import()` inside
Electron's main process, and Node's ESM loader caches that module —
`GROQ_API_KEY` is read once into a frozen `env` object at that first
import. There is no live-reload path without either a much larger
refactor across Phase 2/3 code or restarting the process. Chose the
latter: saving a new Groq key persists it, then calls `app.relaunch()` +
`app.exit(0)` — the whole app restarts and the new key is seeded into
`process.env` before the embedded API's first import happens. The UI is
honest about this ("Save (restarts the app)"), not silently pretending a
live update that isn't actually possible.

**The PKCE / OAuth-client-type question from the earlier discussion was
investigated, not silently dropped:** switching to a "Desktop app" Google
OAuth client type turns out to require **zero** code changes — Google
still issues a client secret for that type, so the existing
`authorization_code` + secret flow keeps working as-is if you just
register the client that way in Cloud Console. Full PKCE
(code_verifier/code_challenge) is a genuine, separate protocol change to
`google-oauth.service.ts` and was deliberately scoped out as a future
security-hardening candidate — documented in `docs/ONBOARDING_SETTINGS.md`
rather than silently skipped.

**Interim storage, deliberately temporary:** the Groq key is currently
persisted as plain JSON (`app-config.ts`, in Electron's `userData`
directory) — not meaningfully more secure than `.env`. This is exactly
what Phase 4.4 exists to fix (`safeStorage`, OS-keychain-backed); scoping
4.3 to "get the UI/flow right" and 4.4 to "harden the storage" keeps each
phase's own test/verification bar honest and focused.

**Docs updated:** new `docs/ONBOARDING_SETTINGS.md`, plus
`CURRENT_STATUS.md` and `docs/IMPLEMENTATION_CHECKLIST.md`.

**Tests/results:** 11 new tests total (`app-config.test.ts` ×4,
`api-client.test.ts` ×2, `App.test.tsx` ×5 — settings open/close, startup
error card, Google status display, Groq key save). Full desktop suite:
**28/29** (the 1 failure is the same pre-existing, unrelated Phase 2.1
alt-text mismatch). `apps/api` untouched this phase — its own 464/464
suite unaffected. Typecheck/lint clean.

**Real (non-mocked) verification, twice:** built and launched actual
Electron against the real dev SQLite database on two separate runs —
confirmed the app starts cleanly with the new `app-config.ts` loading and
four new IPC handlers registered (no crash), confirmed
`GET /integrations/google/status` (the exact route the Settings screen
calls) responds correctly against the live embedded server, confirmed
clean shutdown. Also noticed and correctly attributed: the Google
connection now shows `connected: false` against the fresh SQLite database
— expected, not a bug, since Phase 4.1's engine switch reset to a new
database file; the earlier session's real Google connection was against
the old PostgreSQL data.

**Not verified — the user's own manual validation step:** actually
clicking through the Settings UI in a live window (typing a key, clicking
Save, watching the app restart, completing a live "Sign in with Google"
round-trip end to end). There's no way to drive the native window's GUI
from this environment; the renderer-level behavior is covered by
automated tests that faithfully mock the exact bridge surface
`preload.ts` exposes, which is a different thing from a human clicking
through it.

---

## Addendum: Phase 4.2 - Single-Process Desktop Architecture (September 16, 2026)

Full detail in `docs/SINGLE_PROCESS_DESKTOP.md` — summary for the handoff
record.

**Why:** the second step of making this installable — no more manually
starting the API in one terminal and Electron in another; Electron now
owns the API's lifecycle.

**What changed:** `apps/api/package.json` gained a `main`/`exports` entry
so it can be `import`ed as a library (built via its existing `tsc` build
step — no new build tooling). `apps/desktop` added it as a workspace
dependency. New `apps/desktop/src/main/api-server.ts`:
`startEmbeddedApiServer()` dynamically `import()`s `@ai-agent/api`, calls
its exported `buildApp()`, and `.listen({port: 0, host: "127.0.0.1"})`s —
the OS assigns a free port, read back via `server.server.address()`.
`index.ts` calls this once in `app.whenReady()` and points the existing
(unchanged) `ApiClient` at whatever URL comes back. `DESKTOP_API_URL`
still works as an explicit escape hatch to point at an external API
instance instead, for advanced dev workflows.

**Why a dynamic `import()`, not static:** `@ai-agent/api`'s env validation
runs at module-load time. A static top-level import would run that before
`index.ts`'s own code — including its `try/catch` — even exists, crashing
Electron with an unhandled exception and no useful error. The dynamic
import defers module evaluation into the `try` block, so a real config
problem (e.g. missing `ENCRYPTION_KEY`) shows a real
`dialog.showErrorBox()` instead.

**The one real open risk going into this phase — tested for real, not
assumed:** whether Prisma's native SQLite query engine (an ABI-sensitive
N-API binary) would load inside Electron's main process without an
`engineType = "binary"` override or an `electron-rebuild` step. It does,
cleanly, on Electron 32 with Prisma's default config — confirmed by
actually building and launching Electron (`npx electron .`) against the
real dev SQLite database and reading the main process's own log output:
the embedded server bound a genuine dynamic port (`55104` in the test
run), Prisma ran real `SELECT` queries against `User`/`Intervention`
inside Electron's process, and `GET /api/v1/interventions` returned `200`
with real data. Also verified graceful shutdown for real: closed the
Electron window, confirmed via `netstat`/`Get-Process` that the port was
released and the process actually exited — the `before-quit` handler's
close-then-requit logic works as designed, not just in theory.

**Docs updated:** new `docs/SINGLE_PROCESS_DESKTOP.md`, plus
`CURRENT_STATUS.md` (Quick Start section simplified — no more separate
"Start API" terminal) and `docs/IMPLEMENTATION_CHECKLIST.md`.

**Tests/results:** 4 new tests (`api-server.test.ts`, mocking
`@ai-agent/api`'s `buildApp`) covering dynamic-port request shape, URL
resolution, graceful close, and error propagation. Full desktop suite:
18/19 (the 1 failure is the pre-existing, unrelated "Assistant character"
alt-text mismatch from Phase 2.1 — confirmed via `git stash` in that
phase, untouched since). `apps/api`'s own 464/464 suite unaffected (no
`apps/api/src` code changed — only `package.json`'s `main`/`exports`
field). Typecheck/lint clean across `apps/api` and `apps/desktop`.

**Not yet done (later Phase 4 sub-phases):** no settings UI, no
`safeStorage`, no auto-migration on first launch, no Windows packaging.
`.env` is still how the app is configured — this phase only removed the
two-terminal problem.

---

## Addendum: Phase 4.1 - SQLite Migration (September 16, 2026)

Full detail in `docs/SQLITE_MIGRATION.md` — this is a summary for the
handoff record.

**Why:** first step of making the desktop app installable on Windows/Mac
without Docker or a separately-running database — decided after a lengthy
discussion (not a spec document this time) about what's actually required
to hand this app to another person on their own machine.

**What changed:** Prisma datasource `postgresql` → `sqlite`
(`DATABASE_URL` is now a `file:` path). Prisma's SQLite connector supports
neither native arrays, `Json`, nor `enum` — so `Email.toEmails`/`labels`,
`CalendarEvent.attendeeEmails`/`attendees`, `Integration.scopes`,
`Signal.importanceHints`, `Intervention.actionPayload`,
`AgentRun.outputJson`, and every enum field (`IntegrationProvider`,
`IntegrationStatus`, `SignalType`, `SignalStatus`, `InterventionStatus`,
`Priority`) became plain `String` columns. All four repositories
(`emails`, `calendar-events`, `integrations`, `interventions`) now
serialize/deserialize at the DB boundary and export their own domain types
with the original `string[]`/object shapes — **no route, service, domain
logic, or public repository method signature changed.** Test files that
write to Prisma directly (bypassing a repository, for seeding) were
updated to `JSON.stringify` those fields — see the file list in
`docs/SQLITE_MIGRATION.md`.

**A real bug this would have silently introduced, caught and fixed:**
`Intervention` priority sorting used to rely on PostgreSQL's enum
declaration order for `ORDER BY priority DESC`. With `priority` as a plain
string column, that same query would sort alphabetically —
`medium > low > high > critical`, silently wrong. Fixed by sorting in
application code by an explicit rank map instead. Verified with a real
(non-mocked) runtime smoke test: started the API against a live `dev.db`,
loaded demo data, confirmed `GET /interventions` returns
critical → high → medium → low, confirmed `POST .../done` and its
`actionPayload` JSON round-trips correctly, confirmed `POST /goals` and
`GET /context/daily` work end-to-end.

**Test-db safety carried forward correctly:** `.env.test` now points at a
separate SQLite file (`test.db`) instead of a separate Postgres database;
`tests/setup.ts`'s refuse-to-run-without-an-isolated-test-db guard was
updated to match (checks for a `file:` URL containing "test" in the
filename, not the old `_test` Postgres-naming convention) and re-verified
working.

**Docker Compose's Postgres service was left in the repo** (harmless,
unused) rather than deleted — nothing currently depends on removing it.

**Docs updated:** `AGENTS.md`, `README.md` (multiple sections — Prerequisites,
env example, Troubleshooting, Verification Checklist, Tech Stack),
`QUICK_START.md` (added a redirect banner rather than rewriting throughout
— it was Postgres/Docker-centric top to bottom and is largely superseded by
README.md), `CURRENT_STATUS.md`, `docs/IMPLEMENTATION_CHECKLIST.md`, plus
the new `docs/SQLITE_MIGRATION.md`.

**Tests/results:** `pnpm -r typecheck` and `pnpm -r lint` clean. Full
`apps/api` suite: **464/464 passing**, zero regressions, against the new
isolated SQLite test database.

**Not yet done (later Phase 4 sub-phases, not this one):** no in-app
settings UI, no `safeStorage`-backed secrets, the API and Electron are
still two manually-started processes, no Windows packaging. `.env` files
are still how everything is configured — Phase 4.1 only removed the
Postgres/Docker dependency, nothing else about the setup story changed
yet.

---

## Addendum: Phase 3 - AI Executive Assistant (September 16, 2026)

Implemented all four Phase 3 sub-phases in order, each with its own tests/
typecheck/lint pass before moving to the next, per the phase brief. Also
fixed a real test-infrastructure gap discovered along the way (see below).
Stopped exactly at the phase's own stopping point — no Phase 4 work
started.

### 3.1 — Daily Context

New, read-only `GET /api/v1/context/daily`, built entirely from existing
Phase 2 repositories/services — no new Gmail/Calendar logic. Returns a
bounded `DailyAssistantContext`: `currentTime`, `upcomingEvents` (next 24h),
`relevantEmails` (previous 24h), `activeSignals` (open only),
`consolidatedSituations` (unchanged from Phase 2.6B), and `goals` (added in
3.4). The 24h windows are a pure in-memory filter (`buildDailyContext`) on
top of `EmailsRepository.listRecent`/`CalendarEventsRepository.listUpcoming`
— neither of which is itself date-windowed — rather than modifying those
repositories. See `docs/DAILY_CONTEXT.md`.

### 3.2 — AI Prioritization (daily-context-aware)

`situation-prioritization.service.ts` (used by both `GET /prioritization`
and `POST /assistant/evaluate`) now builds a `DailyAssistantContext` from
the *exact same* already-loaded data it already had (zero new DB calls) and
sends the broader `currentTime`/`upcomingEvents`/`relevantEmails`/`goals`
fields to Groq alongside the unchanged per-situation `situations[]` array.
`buildDailyContextPrioritizationInput` wraps the existing
`buildPrioritizationInput` rather than replacing it. The output JSON Schema
is unchanged — `situationId` is still a literal enum of only the known
`situations[]` IDs, so the model is structurally unable to return a
priority entry for anything in the broader context fields. Prompt bumped
`v1` → `v2` to describe the new fields. See `docs/AI_PRIORITIZATION.md`.

### 3.3 — Proactive Assistant Behavior

**Verification phase — no production code changed.** Phase 2.8A's existing
`assistant-decision.evaluator.ts`/`assistant-decision.rules.ts` already
implemented every rule the phase brief asked for: high always surfaces,
medium only if the relationship is "strong", low never surfaces, an
AI-omitted situation stays silent, and — critically — reuse-before-create
means an intervention that already exists (in *any* status, including
resolved/dismissed/snoozed) is never re-created or re-surfaced. Combined
with `listInbox` only ever returning `pending`/unexpired-`snoozed` rows,
"already completed" and "snoozed" situations already stayed silent with no
new code. Two test gaps were closed: reuse never mutates a stored
intervention's priority/message when the AI's opinion changes on a later
call, and idempotency holds across 3+ repeated evaluations, not just 2. See
`docs/PROACTIVE_ASSISTANT_BEHAVIOR.md`.

### 3.4 — Basic Goals & Commitments

New `Goal` Prisma model (`title`, `description`, `active` — nothing else;
no hierarchy, no progress tracking, no task/project management).
`POST /api/v1/goals`, `GET /api/v1/goals?includeInactive=`,
`PATCH /api/v1/goals/:id` (deactivate via `active: false`; there is no
`DELETE`). Active goals flow into `DailyAssistantContext.goals` and the
Groq prioritization input automatically through the existing Phase 3.1/3.2
pipeline — no separate goals-specific AI pipeline was built. The prompt
instructs the model that a goal-relevant situation may be worth surfacing
more, but explicitly forbids claiming or implying goal progress; a goal can
never be returned as if it were a prioritizable `situationId`. See
`docs/GOALS.md`.

### Test-database safety (fixed a real gap, not just Phase 3 scope)

The phase brief explicitly warned that an earlier session's `pnpm test` run
had wiped real synced Gmail/Calendar data by running against the shared dev
database — there was no isolated test database. Before writing any Phase 3
code, this was fixed:

- New `apps/api/.env.test` — separate `ai_exec_agent_test` Postgres
  database (same Docker container, migrated via the new
  `pnpm test:db:migrate` script), `ENCRYPTION_KEY` copied (not a real
  external credential), and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/
  `GROQ_API_KEY`/`GROQ_MODEL` explicitly blanked (not merely absent —
  absent would have let `env.ts`'s own separate `dotenv.config()` call fall
  through to the real `.env`'s real credentials, which is exactly what
  happened on the first attempt and was caught before it mattered).
- `apps/api/tests/setup.ts` now **requires** `.env.test` and throws if
  `DATABASE_URL` doesn't contain `_test` — the suite refuses to start
  rather than silently running against the real dev DB again.
- Verified: full suite dropped from ~258s (contending with real dev DB
  load) to ~48–58s, and the real dev DB's Google connection/synced
  emails/events were confirmed untouched before and after every test run
  in this session.

### A Prisma-client file lock, encountered and resolved

Creating the `p34_goals` migration's Prisma Client regeneration hit a
Windows `EPERM` (the client DLL was locked by a running `pnpm dev` API
process — likely the user's own, from earlier in this session). Stopped
the process holding port 4000, regenerated the client successfully, then
applied the migration to both the real dev DB and the test DB. **If your
API dev server was running during this work, it will need a manual
restart** (`Ctrl+C`, then `pnpm dev` in `apps/api`) to pick up the new
`Goal` table and the new `/api/v1/goals` and `/api/v1/context/daily`
routes — nothing else about how you run it changed.

### Tests/results

All new/changed areas run clean against the isolated test DB:
`daily-context.builder.test.ts` (12), `daily-context.service.test.ts` (5, 6
after the goals field), `daily-context.api.test.ts` (11, 12 after goals),
`prioritization-input.builder.test.ts` (11, extended with
`buildDailyContextPrioritizationInput` cases), `situation-prioritization.
service.test.ts` (7 → 8), `assistant-evaluate.api.test.ts` (12 → 14, two
new Phase 3.3 idempotency tests), `prioritization.api.test.ts` (7 → 8, one
new Phase 3.2/3.4 test), `goals.service.test.ts` (10, new),
`goals.api.test.ts` (9, new). Full `apps/api` suite: **464/464 passing**,
up from 405 before Phase 3 (all additions, zero regressions). `typecheck`
and `lint` clean across `apps/api` and `packages/shared`; `apps/desktop`
typecheck also re-confirmed clean (untouched this phase).

### Regression status

Nothing in Gmail, Calendar, signal detection, cross-source context, OAuth,
or the desktop app was touched. `packages/shared`'s Zod contracts gained
new exports (`dailyContextResponseSchema`, `goalDtoSchema`, etc.) but no
existing schema's shape changed. `situation-prioritization.service.ts`'s
constructor gained one new optional dependency (`goals`) — existing callers
using the default (real repository) are unaffected; existing unit tests
were updated to mock it explicitly, matching the existing DI pattern used
throughout this codebase.

### Manual validation status — not yet performed

Every claim above is backed by automated tests or local `app.inject()`
integration tests against the isolated test database — **not** a live
Electron window, a real Groq call with real consolidated situations, or a
human clicking through the new `/goals` endpoints via a UI (there is no
goals UI yet — Phase 3 only asked for the API + AI-context wiring). The
user's own manual validation pass, across both Phase 2 and Phase 3, is
still outstanding.

---

## Addendum: Phase 2.8B - Assistant Behavior & Intervention Lifecycle (September 14, 2026)

Primarily a verification pass over Phases 1–2.8A's existing Intervention
lifecycle, desktop polling, and Done/Snooze/Open behavior — with one real
gap found and fixed. No new backend architecture.

**Gap found and fixed:** the desktop overlay had Done and Snooze buttons,
but **no way to trigger `open_source`** — `Intervention.actionPayload
.sourceUrl` was already computed and stored correctly by Phase 2.3/2.5/2.8A,
but nothing in the renderer ever read it or offered a button for it. Added,
minimally, reusing the exact `shell.openExternal` pattern already
established for "Connect Google":
- `apps/api` — **no changes**; the existing `/interventions` API already
  carried everything needed.
- `apps/desktop/src/main/ipc/register-ipc.ts` — new `intervention:open-source`
  IPC handler; validates the URL is well-formed and restricted to `http(s):`
  before calling `shell.openExternal` (defense in depth — even though the
  API-layer trust boundary from Phase 2.8A already guarantees the URL comes
  from stored data, not the AI).
- `apps/desktop/src/main/preload.{ts,cjs}`, `src/renderer/bridge.ts` — added
  `openSource(url)` to the bridge.
- `apps/desktop/src/renderer/components/InterventionCard.tsx` — new "Open"
  button, rendered **only** when `actionType === "open_source"` and a
  `sourceUrl` string is actually present (so the pre-existing Phase 1 demo
  intervention, which has `actionType: "none"`, correctly shows no Open
  button).
- `apps/desktop/src/renderer/App.tsx` — `handleOpen`, mirroring the existing
  `handleDone`/`handleSnooze` busy/error pattern.
- `styles.css` — `.button-open` (outline style, visually distinct from the
  solid Done/neutral Snooze buttons).
- `App.test.tsx` — 3 new tests: Open button hidden when there's no source
  URL, Open button calls the bridge with the correct (stored) URL, Open
  failure shows an error and keeps the card visible. Existing bridge mock
  updated with `openSource`.

**Verified, unchanged (no code needed):**
- Intervention lifecycle (pending → done / pending → snoozed → eligible
  again) — Phase 1's `intervention.service.ts` and repository already
  correctly implement this; Phase 2.8A's reuse-before-create logic already
  respects it (see Phase 2.8A's own addendum above).
- Desktop polling (`use-intervention-polling.ts`, 15s interval, single
  in-flight request, highest-priority-first) — unchanged, still correct.
- Idempotency / no-duplicate-intervention behavior — already covered by
  Phase 2.8A's tests; this phase added 3 more API-level tests for gaps the
  brief specifically called out (medium-priority-eligible-surfaces,
  AI-omitted-situation-skip, multi-situation independence) that were
  previously only unit-tested, not integration-tested.
- Message conciseness (`buildAssistantMessage`, 140-char truncation of the
  AI's `reason`) — unchanged from Phase 2.8A, already correct.

**No changes to:** Gmail/Calendar sync, signal detection (2.3/2.5),
cross-source context (2.6A), consolidated situations (2.6B), or AI
prioritization (2.7) — confirmed via `git status` (zero diffs in those
files/directories this phase) and by their full test suites passing
unchanged.

**Tests added:** 3 new API integration tests in
`tests/assistant-evaluate.api.test.ts` (medium-priority eligibility via
strong relationship, AI-omitted situation, two independent situations in one
call — all real DB), 3 new desktop tests in `App.test.tsx` (Open
button — see above). **API suite total: 405/405 passing** (402 + 3).
Desktop: 14/15 (11 original + 3 new; the 1 failure is the same
pre-existing, unrelated `App.test.tsx` alt-text mismatch confirmed via
`git stash` back in Phase 2.1 — still present, still unrelated).

**Local smoke test performed (distinct from full manual product
validation):** booted the real API against the real Postgres dev database
and, via `curl` only (no Electron GUI was driven in this session):
1. Confirmed `POST /assistant/evaluate` returns cleanly against real data.
2. Confirmed `GET /interventions` — the exact endpoint the desktop polls —
   returned the pre-existing leftover Phase 1 demo intervention.
3. Called `POST /interventions/:id/done` against that real row and
   confirmed it correctly disappeared from the next `GET /interventions`
   response, proving the Done → exclusion lifecycle works against a real
   database end-to-end.

This confirms the **API-side** lifecycle genuinely works against real data.
It does **not** constitute full manual validation of the running Electron
desktop application, the character overlay rendering, or a live OpenAI call
— none of those were exercised in this session. **A full manual end-to-end
product walkthrough by the user, across the whole Phase 2 feature set, is
still outstanding and intentionally deferred**, per this phase's explicit
instructions not to block implementation on it.

---

## Addendum: Phase 2 Final Integration & Manual Validation Prep (September 14, 2026)

Verification-only pass. No product features were added; only two clear
startup/documentation blockers were fixed (see below). Purpose: confirm the
repo can actually be started and exercised locally ahead of the user's own
manual validation pass.

**Blocker found (machine-level, not a code bug):** on this machine, a
Windows **user-level** environment variable `DATABASE_URL` was already set
to `postgresql://postgres:postgres@localhost:5432/ai_exec_agent` (port
5432). Node's `dotenv.config()` does not override an already-set
environment variable, so this stale value silently won over the correct
`postgresql://...@localhost:5433/...` in `.env`/`apps/api/.env`, causing
every DB-backed route (and `pnpm db:demo-tasks`/`db:seed`) to fail with a
Prisma `Authentication failed` error even though `.env` was correct and
Postgres itself was healthy. **This is not a repo bug** — nothing in the
repo was changed for it — but it will block the user's own manual run if
their shell has the same stale variable. Fix on the user's side: check with
`echo $env:DATABASE_URL` (PowerShell) and remove/correct it
(`[Environment]::SetEnvironmentVariable('DATABASE_URL', $null, 'User')`),
or always launch via a fresh shell where no `DATABASE_URL` is pre-set.

**Fixes actually made to the repo (both trivial, no logic changes):**
- [README.md](../README.md): the example `GOOGLE_REDIRECT_URI` used a
  stale path (`/api/v1/auth/google/callback`) that doesn't match the real
  route (`/api/v1/integrations/google/callback`, already correct in
  `.env.example`). Anyone copying the README's example into Google Cloud
  Console would have misconfigured OAuth. Fixed to match.
- `docs/IMPLEMENTATION_CHECKLIST.md`: added the missing Phase 2.8B line
  under Phase 1.5 (Open action), and `CURRENT_STATUS.md`'s roadmap list
  mislabeled Phase 2.8B as "automatic/scheduled evaluation" (that was
  never implemented) — corrected to describe what 2.8B actually shipped.

**What was verified working, with a real Postgres and a real API process
(once the stale env var above was bypassed for this session only —
nothing persisted to the machine):**
- `pnpm install` dependencies already present and consistent.
- `prisma migrate status` — all 5 migrations applied, schema up to date.
- API startup (`pnpm dev` in `apps/api`) — reaches
  `Server listening at http://127.0.0.1:4000`.
- `GET /api/v1/health` → `200 {"status":"ok",...}`.
- Every Phase 2 route is registered and reachable (see table below).
- `pnpm db:demo-tasks` — creates the demo user + 4 interventions.
- `GET /api/v1/interventions` → returns the 4 seeded interventions.
- A real `POST /interventions/:id/done` against one of them → `200`,
  `status: "resolved"`, and it correctly disappeared from the next
  `GET /api/v1/interventions` (3 remaining, left in place for the user's
  own manual walkthrough).
- `apps/desktop`: `tsc --noEmit` typecheck clean; the actual
  `electron:dev` build step (`tsc` + `copy-preload.mjs`) succeeds and
  produces `dist/main/index.js` and `dist/main/preload.cjs`.
- `apps/desktop/src/main/config.ts` defaults `DESKTOP_API_URL` to
  `http://localhost:4000`, matching the API's default port — no mismatch.
- Desktop's `resolve`/`snooze` API-client calls hit
  `/interventions/:id/done` and `/interventions/:id/snooze` — confirmed to
  match the actual registered routes exactly.

**Not verified in this pass (requires the user, real credentials, or a
GUI):** launching the actual Electron window and visually confirming the
overlay/character/cards render; clicking Done/Snooze/Open in the live UI;
a real Google OAuth connect flow (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
are not configured in this environment); a real OpenAI prioritization call
(`OPENAI_API_KEY` is not configured). These remain the user's own manual
validation to perform — see the checklist in the accompanying report.

---

## Addendum: Groq Provider Swap (September 15, 2026)

During the manual validation pass above, the user completed real Google
OAuth (with their own Cloud project) and successfully synced real
Gmail/Calendar data, but did not have OpenAI API access to exercise Phase
2.7's AI prioritization. **All Phase 2.7/2.8A AI calls now use Groq instead
of OpenAI.** This is a provider swap only — no domain, routing, prompt
content, or JSON-schema-structure logic changed; the only prior-phase docs
now stale from this are the historical Phase 2.7/2.8A addendums further
below, which still accurately describe what was true *at the time those
phases were built* (they used OpenAI, correctly) — they were intentionally
left as-is rather than rewritten, since they're a historical record, not
current-state docs. `docs/AI_PRIORITIZATION.md` and
`docs/ASSISTANT_EVALUATION.md` (the current-state docs) were updated to
reflect Groq.

**What changed:**
- New `apps/api/src/providers/groq/` (moved from `providers/openai/`,
  which no longer exists): `groq-client.ts` (was `openai-client.ts`),
  `prioritization-prompt.ts`, `prioritization-schema.ts` (prompt/schema
  content unchanged, only relocated).
- `groq-client.ts` still uses the `openai` npm package (unchanged
  dependency) — Groq exposes an OpenAI-SDK-compatible endpoint at
  `https://api.groq.com/openai/v1`, so no new package was needed. The one
  real difference: Groq has no Responses API, only Chat Completions, so
  the call is `client.chat.completions.create({ messages: [...],
  response_format: { type: "json_schema", json_schema: { strict: true,
  ... } } })` instead of `client.responses.create({ instructions, input,
  text: { format: { type: "json_schema", ... } } })`. The provider
  interface (`createStructuredCompletion`) callers depend on is unchanged.
- `env.ts`: `OPENAI_API_KEY`/`OPENAI_MODEL` → `GROQ_API_KEY`/`GROQ_MODEL`.
  Default model: `qwen/qwen3-32b` — one of the three Groq models
  currently supporting strict structured-output mode (the other two:
  `openai/gpt-oss-120b`, `openai/gpt-oss-20b`); this project's structured
  output already relies on strict mode (`situationId` as a literal enum
  to prevent invented IDs), so an arbitrary `GROQ_MODEL` override could
  silently fail schema validation if it doesn't support strict mode.
- `.env.example`, `.env`, `apps/api/.env`, `README.md`, `QUICK_START.md`:
  `OPENAI_API_KEY`/`OPENAI_MODEL` → `GROQ_API_KEY`/`GROQ_MODEL` (both were
  empty/placeholder in the real `.env` files — no secret was overwritten).
- Tests updated in place, same coverage as before (provider client,
  prioritization service, prioritization API, assistant-evaluate API) —
  mock import paths and a few "OpenAI ..." error-message strings changed
  to "Groq ...", nothing else.
- `pnpm -r typecheck` clean, `pnpm --filter @ai-agent/api test` full suite
  passing after the swap (see test-run output near this addendum's commit
  for exact counts).

**Not yet exercised with a real Groq key in this session** — the swap was
implemented and unit/integration-tested with the provider mocked, same as
every other AI-touching test in this codebase always has been. A live
`GET /api/v1/prioritization` call against a real Groq API key, with real
consolidated situations, is still the user's own manual validation step.

---

## Addendum: Phase 2.8A - Assistant Decision & Intervention Orchestration (September 14, 2026)

Connects Phase 2.7's advisory AI prioritization to the **existing**
Intervention system — the first phase where AI output is allowed to result
in a real `Intervention` row. The AI still never touches the database,
never picks the action URL, and never unilaterally decides whether
something surfaces; the application layer does. Full details:
[docs/ASSISTANT_EVALUATION.md](./docs/ASSISTANT_EVALUATION.md).

**Added:**
- `apps/api/src/domain/assistant/` — `assistant-decision.types.ts`,
  `assistant-decision.rules.ts` (deterministic surfacing rule: high always
  eligible; medium eligible only when the Phase 2.6A relationship is
  `strong`; low never proactively surfaced; message-truncation rule),
  `assistant-decision.evaluator.ts` (pure function — no Prisma, no OpenAI;
  reuse-before-create logic; the action URL always comes from stored
  Email/CalendarEvent data — `PrioritizedSituationResult`, the AI's own
  output type, has no URL field at all, so the trust boundary is enforced
  at the type level). `.test.ts` (17 tests: high/medium/low rules, AI-omitted
  situations, reuse/idempotency, primary-signal source-URL selection, message
  truncation, determinism).
- `apps/api/src/domain/assistant-evaluation.service.ts` — orchestration
  only: loads situations (existing `ConsolidatedSituationsService`), runs AI
  prioritization (existing `SituationPrioritizationService`, unmodified),
  checks `InterventionsRepository.findBySignalId` across **every** signal in
  each situation (not just the primary one, since Phase 2.3/2.5's own
  `detect-signals` endpoints may have already created one independently),
  and calls the existing `interventions.create` for genuinely new, eligible
  situations only. `.test.ts` (8 tests, including a repeated-evaluation
  idempotency test and a multi-situation test).
- `POST /api/v1/assistant/evaluate` — new route file. Reuses the existing
  `AppError`/global error handler for AI-failure mapping (`400`/`502`,
  identical to Phase 2.7's own mapping).
- `assistantEvaluationResponseSchema` and related types in `packages/shared`.
- `tests/assistant-evaluate.api.test.ts` (9, real DB + mocked OpenAI
  provider) — creation, reuse-on-repeat, **an already-snoozed intervention
  stays reused rather than resurfaced**, **an already-done intervention
  stays reused rather than recreated** (both verified by actually calling
  the existing `/interventions/:id/snooze` and `/done` endpoints mid-test),
  low-priority non-surfacing, AI-failure with zero side effects, zero new
  Signal rows, no sensitive-content leakage.

**No desktop code was changed.** New interventions are ordinary
`Intervention` rows, so the desktop's existing `/interventions` polling
picks them up automatically — verified by a real `curl` smoke test against
the running API confirming `GET /interventions` behaves exactly as before.

**No new database table, no Prisma migration, no new signal type** —
confirmed via `git status` (only the three pre-existing migration folders
from earlier phases appear) and by reusing `SignalType.user_action_required`
throughout.

**Verification status:** All 402 API tests pass (34 new this phase: 17
evaluator + 8 orchestration + 9 API integration), typecheck/lint clean on
all workspaces. Manually smoke-tested via `curl` against the real API + real
Postgres: `POST /assistant/evaluate` correctly returned `{"results":[]}`
(dev DB currently has no consolidated situations), and `GET /interventions`
continued returning the pre-existing leftover demo intervention unchanged,
confirming the desktop-facing contract is untouched. Desktop: 11/12, same
pre-existing unrelated failure; zero desktop files touched.

**No live OpenAI call was made** — every test mocks the provider at the
same `openai-client.js` boundary Phase 2.7 already established.

---

---

## Addendum: Phase 2.7 - AI Prioritization (September 14, 2026)

First LLM layer — advisory only. Ranks and explains *existing* Phase 2.6B
consolidated situations; cannot create signals/interventions, read Gmail/
Calendar, or take any action. Full details:
[docs/AI_PRIORITIZATION.md](./docs/AI_PRIORITIZATION.md).

**Added:**
- `openai` npm dependency (^7.15.0) — the only new dependency this phase;
  used exclusively inside `apps/api/src/providers/openai/openai-client.ts`.
- `apps/api/src/providers/openai/` — `openai-client.ts` (thin wrapper around
  the Responses API with structured JSON-schema output; maps SDK errors to
  safe generic messages, never leaks raw provider payloads), `.test.ts` (6,
  mocked `openai` package — no live API key used), `prioritization-prompt.ts`
  (versioned system prompt, `PRIORITIZATION_PROMPT_VERSION = "v1"`),
  `prioritization-schema.ts` (builds the per-request JSON Schema with
  `situationId` constrained to an `enum` of the actual IDs in that request —
  the model is structurally prevented from inventing one).
- `apps/api/src/domain/prioritization/` — `prioritization.types.ts`,
  `prioritization-input.builder.ts` (pure function; whitelists exactly the
  fields documented — email subject/sender/snippet/receivedAt, calendar
  summary/start/end/attendees, signal confidence/dueAt; **never** email body
  or calendar description) + `.test.ts` (6), `prioritization.service.ts`
  (the core AI-calling service — calls the provider, JSON-parses, validates
  with Zod, then filters out any entry with an unrecognized `situationId` or
  invalid `priority` rather than failing the whole batch; testable entirely
  without a live OpenAI call) + `.test.ts` (12: valid/multi/invalid-id/
  invalid-priority/malformed/not-configured/provider-error/determinism/
  bounded-schema).
- `apps/api/src/domain/situation-prioritization.service.ts` — orchestration
  only: loads situations (existing, unmodified `ConsolidatedSituationsService`)
  and their related `Email`/`CalendarEvent`/`Signal` records via **existing**
  repository methods (`listRecent`, `listUpcoming`, `listOpen` — no new
  repository methods added this phase), builds the bounded input, calls the
  core service. Skips the AI call entirely (and the data loading) when there
  are zero situations. `.test.ts` (5).
- `GET /api/v1/prioritization` — new route file, registered under
  `/api/v1/prioritization`. Maps `not_configured` → 400, `provider_error`/
  `malformed_output` → 502, reusing the existing `AppError`/global error
  handler exactly as every other route does.
- `prioritizationResponseSchema` and related types in `packages/shared`.
- `tests/prioritization.api.test.ts` (7, real DB + mocked OpenAI provider) —
  empty-situations short-circuit, structured success, provider-failure and
  malformed-output error mapping, zero new Signal/Intervention rows, and a
  test confirming the calendar `description` never reaches the AI request
  while the (already-stored, already-bounded) email snippet legitimately
  does.
- `.env.example` — added a comment clarifying `OPENAI_MODEL`'s default
  (`gpt-4o-mini`); both env vars already existed from Phase 1 scaffolding.

**No new database table, no Prisma migration, no new repository methods** —
confirmed via `git status` (only the three pre-existing migration folders
from earlier phases appear) and via reading `interventions.repository.ts`/
`emails.repository.ts`/`calendar-events.repository.ts` diffs (none touched).

**Verification status:** All 368 API tests pass (37 new this phase: 6
provider + 6 input-builder + 12 core-service + 5 orchestration + 7 API
integration — one transient DB cold-start timeout on first run, passed
cleanly on retry), typecheck/lint clean on all workspaces. Manually
smoke-tested via `curl` against the real API + real Postgres — `GET
/prioritization` correctly returned `{"prioritizedSituations":[]}` without
calling OpenAI, since the dev DB currently has no open Signal rows (and thus
no consolidated situations). Desktop: 11/12, same pre-existing unrelated
failure; zero desktop files touched (confirmed via `git status`).

**No live OpenAI call was made** — every test mocks the provider at the
`openai-client.js` module boundary or the underlying `openai` package
itself; no `OPENAI_API_KEY` was available or used in this session.

---

---

## Addendum: Phase 2.6B - Context-Aware Signal Evaluation (September 14, 2026)

Deterministic grouping only — no AI/LLM. Recognizes when an existing email
signal (Phase 2.3) and an existing calendar signal (Phase 2.5) represent the
same real-world situation, using Phase 2.6A's cross-source context
**entirely as-is** — no new correlation logic was added. Read-only; creates
no `Signal`/`Intervention` rows. Full details:
[docs/CONSOLIDATED_SITUATIONS.md](./docs/CONSOLIDATED_SITUATIONS.md).

**Added:**
- One additive method on the existing `SignalsRepository`:
  `listOpen(userId)` — returns open signals for a user, ordered by
  `createdAt`. Two existing test mock factories
  (`gmail-signal-detection.service.test.ts`,
  `calendar-signal-detection.service.test.ts`) updated to satisfy the
  extended interface; their own tests are unchanged and still pass.
- `apps/api/src/domain/context/consolidated-situation.{types,evaluator}.ts`
  — pure function `evaluateConsolidatedSituations(signals, contexts)`: for
  each Phase 2.6A relationship, consolidates only when both an open email
  signal and an open calendar signal already exist for its two sides.
  Primary-signal selection is a strict 3-rule deterministic chain: (1)
  higher `importanceHints.confidence` wins, (2) a concrete `dueAt` wins a
  tie (in practice this favors the calendar signal, since Gmail signals
  don't set one), (3) earlier `createdAt` breaks any remaining tie. `.test.ts`
  (16 tests: grouping, both relationship strengths, multi-situation,
  multi-email-per-event, all three primary-selection rules, malformed
  `importanceHints`, determinism).
- `apps/api/src/domain/consolidated-situations.service.ts` — loads open
  signals (new `listOpen`) and cross-source context (**existing**, unmodified
  `CrossSourceContextService`), hands both to the pure evaluator. `.test.ts`
  (5 tests).
- `GET /api/v1/context/situations` — added to the existing
  `apps/api/src/routes/context.ts` (alongside Phase 2.6A's `/cross-source`,
  no new route file). Read-only.
- `consolidatedSituationsResponseSchema` and related types in
  `packages/shared`.
- `tests/consolidated-situations.api.test.ts` (8, real DB) — consolidation,
  independence of unrelated signals, generic-word non-consolidation, zero
  new Signal/Intervention rows, no sensitive-content leakage, exact field
  shape.

**No new database table, no Prisma migration** — confirmed via `git status`
(only the three pre-existing migration folders from earlier phases appear).

**Verification status:** All 332 API tests pass (29 new this phase: 16
evaluator + 5 service + 8 API integration), typecheck/lint clean on all
workspaces. Manually smoke-tested via `curl` against the real API + real
Postgres — `/situations` correctly returned `{"situations":[]}` against the
dev DB (no Signal rows currently exist there), and `/cross-source` continues
to work unchanged. Desktop: 11/12, same pre-existing unrelated failure; zero
desktop files touched (confirmed via `git status`).

---

---

## Addendum: Phase 2.6A - Cross-Source Context Foundation (September 14, 2026)

Deterministic correlation only — no AI/LLM. Looks at already-stored Gmail
emails and Calendar events together and finds obvious relationships between
them, as a read-only, unpersisted, in-memory computation. Does **not**
create signals or interventions. Full details:
[docs/CROSS_SOURCE_CONTEXT.md](./docs/CROSS_SOURCE_CONTEXT.md).

**Added:**
- `apps/api/src/domain/context/` — `cross-source-context.types.ts`,
  `cross-source-context.rules.ts` (stop-word list explicitly including
  "meeting"/"project"/"update"/etc., 14-day email window, 7-day calendar
  window, 25-record fetch cap, min token length 4),
  `cross-source-context.builder.ts` (pure function: given already-loaded
  Email/CalendarEvent-shaped inputs, returns relationships — never touches
  Prisma or any API). `.test.ts` (21 tests: attendee matching,
  case/punctuation insensitivity, generic-word exclusion, combined evidence,
  temporal-proximity-alone rejection, missing-field handling, multi-record
  cross product, determinism).
- `apps/api/src/domain/cross-source-context.service.ts` — loads data via
  the **existing** `EmailsRepository.listRecent` and
  `CalendarEventsRepository.listUpcoming` (unmodified, no new repository
  methods), filters to the day-windows, hands the result to the pure
  builder. `.test.ts` (8 tests, including exact-boundary-day filtering).
- `GET /api/v1/context/cross-source` — read-only; returns
  `{contexts: [...]}` only.
- `crossSourceContextResponseSchema` and related types in `packages/shared`.
- `tests/cross-source-context.api.test.ts` (7, real DB) — including explicit
  tests that the endpoint creates zero `Signal`/`Intervention` rows and
  never exposes email snippet/calendar description content or credentials.

**Two relationship types, two strength tiers (no numeric score):**
`attendee_match` → always `strong`; `topic_overlap` → always `possible`.
When both evidence types exist for the same pair, the result stays `strong`
(no third tier) with the overlapping terms attached as bonus context.

**No new database table** — nothing is persisted; every response is
computed fresh from existing `Email`/`CalendarEvent` rows.

**Verification status:** All 303 API tests pass (36 new this phase: 21
builder + 8 service + 7 API integration), typecheck/lint clean on all
workspaces. Manually smoke-tested via `curl` against the real API + real
Postgres — genuinely correlated the leftover Phase 1 demo email ("...launch
assets") with the leftover demo calendar event ("Product Launch") via shared
terms `launch`/`product`, confirming the topic-overlap rule works end to end
on real (if old) data. Desktop: 11/12, same pre-existing unrelated failure;
zero desktop files touched (confirmed via `git status`).

**No live Gmail/Calendar API calls were made** — this phase only reads
already-persisted rows; no mocking of Google APIs was even needed since
nothing external is called.

---

## Addendum: Phase 2.5 - Calendar Signal Detection (September 14, 2026)

Deterministic, time-based only — no LLM/AI. Detects upcoming meetings from
already-stored `CalendarEvent` rows (Phase 2.4B) and pushes them through the
**existing, unmodified** Signal/Intervention pipeline — the same one Gmail
signals (Phase 2.3) and the Phase 1 demo pipeline use. Full details:
[docs/CALENDAR_SIGNALS.md](./docs/CALENDAR_SIGNALS.md).

**Added:**
- `apps/api/src/domain/signals/calendar/` — `upcoming-meeting.types.ts`,
  `upcoming-meeting.rules.ts` (two named constants:
  `ACTIONABLE_WINDOW_MINUTES = 30`, `HIGH_PRIORITY_WINDOW_MINUTES = 10`),
  `upcoming-meeting.detector.ts` (pure, deterministic, never-throwing).
  `.test.ts` (25 tests: positive/negative/boundary/attendee-context/edge
  cases, including exact-30/exact-10-minute boundaries and confirming
  attendee count never affects the decision).
- `apps/api/src/domain/calendar-signal-detection.service.ts` —
  orchestration only: loads upcoming `CalendarEvent` rows (already filtered
  to `startAt >= now` by the existing repository), runs the detector, and
  for actionable ones calls the same `SignalsRepository`/
  `InterventionsRepository` Gmail signals use, find-or-create. Signal's
  `dueAt` is set to the meeting's `startAt` (an improvement over Gmail
  signals, which have no natural due date). `.test.ts` (16 tests).
- `POST /api/v1/integrations/google/calendar/detect-signals?limit=` (max
  25) → `{analyzed, actionable, signalsCreated, interventionsCreated}`.
- `calendarSignalDetectionResponseSchema`/`QuerySchema` in `packages/shared`.
- `tests/calendar-signal-detection.api.test.ts` (8, real DB) — includes a
  test confirming detection never triggers a Calendar sync as a side effect,
  and one running a generated intervention through the existing
  Snooze/Done endpoints.

**Signal type/source reused as-is:** `user_action_required` (no schema
change). `sourceType: "calendar_event"`, `sourceId: CalendarEvent.id`.

**All-day events are explicitly excluded** — the detector's `isAllDay` gate
rejects them outright, since all-day `startAt` is anchored to UTC midnight
by the sync layer and treating it like a timed meeting would produce a
nonsensical countdown. Documented as an intentional limitation, not a bug.

**Idempotency:** no new dedup mechanism — relies entirely on the pre-existing
`Signal.@@unique([userId, type, sourceType, sourceId])` and
`Intervention.@@unique([signalId])`, the same constraints Gmail signals use.

**Verification status:** All 267 API tests pass (49 new this phase: 25
detector + 16 orchestration + 8 API integration), typecheck and lint clean
on all workspaces. Manually smoke-tested via `curl` against the real API +
real Postgres. Desktop: 11/12 (same pre-existing, unrelated failure; zero
desktop files touched this phase — confirmed via `git status`).

**No live Google Calendar data was analyzed** — detector tests use
hand-built `CalendarEvent` fixtures, not real Calendar API responses.

---

## Addendum: Phase 2.4A/2.4B - Google Calendar Read Access, Persistence & Sync (September 14, 2026)

Mirrors the Gmail pattern (2.2A read / 2.2B persistence) for Calendar. No
signal detection, no AI, no writes. Full details:
[docs/GOOGLE_CALENDAR.md](./docs/GOOGLE_CALENDAR.md).

**Added:**
- `apps/api/src/providers/google/calendar/{calendar.types,calendar.service}.ts`
  — wraps `google.calendar({version:"v3"})`, queries the primary calendar
  with `timeMin=now`, `singleEvents=true`, `orderBy=startTime`, excludes
  cancelled events, normalizes timed and all-day events. `.test.ts` (11).
- `apps/api/src/providers/google/google-api-error.ts` — the Gmail error
  mapper extracted into a shared helper (`mapGoogleApiError(err, serviceLabel)`)
  so Calendar doesn't duplicate it; `gmail.service.ts` now delegates to it
  with identical message text, verified by rerunning its existing tests
  unchanged before proceeding.
- `apps/api/src/domain/calendar-events.service.ts` (2.4A, reuses
  `google-connection.service.ts`'s `getDecryptedRefreshToken`, same as
  Gmail) + `.test.ts` (10).
- `GET /api/v1/integrations/google/calendar/events?limit=` (2.4A).
- **2.4B**: extended the `CalendarEvent` model (already existed from Phase 1)
  with `location`, `isAllDay`, `status`, `organizerName`, `attendees Json?`
  — migration `20260914101744_p24b_calendar_event_fields`. The model's
  existing `@@unique([userId, calendarId, providerEventId])` already
  provided exactly the idempotency key needed; no new constraint was added.
- `apps/api/src/db/repositories/calendar-events.repository.ts`
  (`upsertEvent`/`upsertMany`/`findByProviderEventId`/`listUpcoming`,
  find-then-create/update like `emails.repository.ts`) + `.test.ts` (12,
  real DB — new/update/idempotent-repeat/uniqueness/cross-user/all-day/timed/
  timestamps all covered).
- `apps/api/src/domain/calendar-sync.service.ts` (transforms
  `NormalizedCalendarEvent` → persistence input; anchors all-day dates to
  UTC midnight; skips, rather than crashes on, an event with an unparsable
  start/end) + `.test.ts` (11).
- `POST /api/v1/integrations/google/calendar/sync?limit=` (max 25) →
  `{fetched, created, updated}`; `GET /calendar/stored-events?limit=` (max
  50, local-DB read only).
- `calendarSyncResponseSchema`, `storedCalendarEventsResponseSchema` in
  `packages/shared`; `location`/`isAllDay`/`status`/`organizerName` added to
  the previously-unused `calendarEventSchema`.
- `tests/calendar-events.repository.test.ts` (12, real DB),
  `tests/google-calendar-sync.api.test.ts` (10, real DB + mocked
  `googleapis`).

**Not implemented (by design, per scope rules):** Calendar signal detection,
AI, event writes (create/update/delete), attendee-response mutation,
reminders, background/scheduled sync — sync is manually triggered only,
same as Gmail's 2.2B.

**Verification status:** All 218 API tests pass (33 new this phase: 11
Calendar service + 10 events-service (2.4A) + 12 repository + 11 sync-service
+ 10 API integration — some overlap between phases in one session; see the
2.4A report for its own count), typecheck/lint clean on all workspaces.
Manually smoke-tested via `curl` against the real API + real Postgres: clean
404/400 error paths, and `/stored-events` correctly serialized a genuine
leftover Phase-1 demo `CalendarEvent` row from the dev database. Desktop:
11/12, same pre-existing unrelated failure; zero desktop files touched.

**No live Google Calendar sync was performed** — all Calendar responses in
tests are mocked; no real `GOOGLE_CLIENT_ID`/`SECRET` were available.

---

## Addendum: Phase 2.3 - Actionable Email Signal Detection (September 14, 2026)

Implemented the first intelligence layer — entirely deterministic, no LLM/AI
of any kind. Detects obvious actionable emails from already-stored Gmail
metadata (Phase 2.2B) and pushes them through the **existing** Phase 1
signal/intervention pipeline unchanged. Full details:
[docs/GMAIL_SIGNALS.md](./docs/GMAIL_SIGNALS.md).

**Added:**
- `apps/api/src/domain/signals/email/` — `actionable-email.types.ts`,
  `actionable-email.rules.ts` (phrase lists + sender/label exclusions),
  `actionable-email.detector.ts` (pure, deterministic, never-throwing
  function: same input → same output). `.test.ts` (27 tests: positive,
  negative, and edge cases — missing sender/subject/snippet, invalid dates,
  duplicate phrases, capitalization, etc.).
- `apps/api/src/domain/gmail-signal-detection.service.ts` — orchestration
  only: loads recent `Email` rows, runs the detector, and for actionable
  ones calls the **existing** `SignalsRepository`/`InterventionsRepository`
  (the same ones the Phase 1 demo pipeline uses) with find-or-create
  semantics. No new signal/intervention system. `.test.ts` (15 tests).
- `POST /api/v1/integrations/google/gmail/detect-signals?limit=` (max 25) →
  `{analyzed, actionable, signalsCreated, interventionsCreated}`.
- `gmailSignalDetectionResponseSchema`/`QuerySchema` in `packages/shared`.
- `tests/gmail-signal-detection.api.test.ts` (7, real DB) — includes a test
  that runs a generated intervention through the *existing* Snooze/Done
  endpoints to confirm the lifecycle is untouched.

**Signal type reused as-is:** `user_action_required` (already existed in the
`SignalType` enum from Phase 1 — no schema change needed). Source:
`sourceType: "email"`, `sourceId: Email.id` (the internal DB id, not the
Gmail message id — matches the existing `Signal` model's expectations).

**Idempotency:** relies entirely on constraints that already existed —
`Signal`'s `@@unique([userId, type, sourceType, sourceId])` and
`Intervention`'s `@@unique([signalId])`. No new dedup mechanism was built.

**Verification status:** All 156 API tests pass (49 new this phase: 27
detector + 15 orchestration + 7 API integration; 107 carried over from Phase
2.2B), typecheck and lint clean on all workspaces. Manually smoke-tested via
`curl` against the real API + real Postgres. Desktop: 11/12 (same
pre-existing, unrelated failure; no desktop files touched this phase — new
interventions flow through the existing polling unchanged since the endpoint
just writes normal `Intervention` rows).

**No live Gmail data was analyzed** — detector tests use hand-built email
fixtures, not real Gmail responses.

---

## Addendum: Phase 2.2B - Email Persistence & Synchronization (September 14, 2026)

Implemented Gmail *persistence* only — a manually-triggered, idempotent sync
of Gmail metadata into the (already-existing) `Email` table. No AI, no
signals, no Calendar, no background jobs. Full details:
[docs/GOOGLE_OAUTH.md](./docs/GOOGLE_OAUTH.md#4b-gmail-persistence--sync-phase-22b).

**Added:**
- `Email.labels String[]` column + migration
  (`20260914090419_p22b_email_labels`) — the `Email` model itself already
  existed from Phase 1; this phase added the one missing field its unique
  constraint and other columns needed.
- `apps/api/src/db/repositories/emails.repository.ts` — `upsertEmail` (find
  then create/update, returns whether it created or updated),
  `upsertMany` (tallies created/updated), `findByProviderMessageId`,
  `listRecent`. `.test.ts` runs against the real Postgres test DB per project
  convention (constraint/uniqueness tests need a real database).
- `apps/api/src/domain/gmail-sync.service.ts` — transforms
  `NormalizedGmailMessage` (from the existing Phase 2.2A Gmail service) into
  `Email` rows: parses `From`/`To` headers into `fromEmail`/`fromName`/
  `toEmails`, derives `isRead` from the Gmail `UNREAD` label, resolves
  `receivedAt` with a `Date` header → `internalDate` → now fallback chain,
  and defaults a missing subject to `"(no subject)"`. `.test.ts`.
- `POST /api/v1/integrations/google/gmail/sync?limit=` — runs the sync,
  returns `{fetched, created, updated}` only (never email contents).
- `GET /api/v1/integrations/google/gmail/stored-messages?limit=` — minimal
  read of what's already persisted, for local testing/inspection only.
- `gmailSyncResponseSchema`, `storedEmailDtoSchema`,
  `storedEmailsResponseSchema` in `packages/shared`; `labels` added to the
  existing (previously unused) `emailSchema`.
- Tests: `emails.repository.test.ts` (10, real DB),
  `gmail-sync.service.test.ts` (12, mocked), `google-gmail-sync.api.test.ts`
  (9, real DB + mocked Gmail) — 31 new tests, 107 total in `apps/api`.

**Refactor (justified by "don't duplicate token decryption" in the task
brief):** added `getDecryptedRefreshToken(userId)` to the existing
`google-connection.service.ts` and switched both `gmail-messages.service.ts`
(2.2A) and the new `gmail-sync.service.ts` to call it, instead of each
independently looking up the `Integration` row and calling `decryptSecret`.
`NormalizedGmailMessage` also gained one field, `internalDate` (Gmail's own
epoch-ms timestamp), needed as a reliable `receivedAt` fallback since the
`Date` header can be missing or malformed — `gmail.service.ts` and its tests
were updated accordingly, its public `/messages` API response is unchanged.

**Verification status:** All 107 API tests pass, typecheck clean on all 5
workspaces, lint clean on `api`/`shared` (only the pre-existing
`preload.cjs` warning remains). Manually smoke-tested via `curl` against the
real running API + real Postgres: confirmed a clean 404 syncing without a
Google connection, a clean 400 for `limit=9999`, and confirmed
`/stored-messages` correctly serializes a genuine row from the dev database.
**No live OAuth + Gmail API sync against a real Google account was
performed** in this session (no real `GOOGLE_CLIENT_ID`/`SECRET` available) —
all Gmail responses in tests are mocked.

---

## Addendum: Phase 2.2A - Gmail Read-Only Access (September 14, 2026)

Implemented Gmail *access* only — a small, controlled read against the
existing Google connection. No persistence, no signals, no AI, no Calendar.
Full details: [docs/GOOGLE_OAUTH.md](./docs/GOOGLE_OAUTH.md#4a-gmail-read-only-access-phase-22a).

**Added:**
- `apps/api/src/providers/google/gmail/` — `gmail.types.ts` (normalized
  message shape, limit constants), `gmail.service.ts` (wraps `googleapis`'
  `google.gmail`, maps errors to safe `AppError`s), `.test.ts`.
- `apps/api/src/domain/gmail-messages.service.ts` — loads the user's
  `Integration`, decrypts the refresh token via the existing `crypto.ts`,
  clamps the requested limit, delegates to the Gmail service. `.test.ts`.
- `GET /api/v1/integrations/google/gmail/messages?limit=` route
  (`apps/api/src/routes/google-gmail.ts`), registered under the same
  `/api/v1/integrations/google` prefix as Phase 2.1.
- `apps/api/src/providers/google/oauth/google-oauth.service.ts` gained one
  new method, `createAuthorizedClient(refreshToken)`, reused by the Gmail
  service instead of duplicating OAuth2 client construction.
- `upstreamError` (502) and `forbiddenError` (403) helpers added to
  `apps/api/src/lib/errors.ts` (the `forbidden` code already existed in the
  type union but had no factory function).
- `gmailMessageSchema`, `gmailMessagesResponseSchema`,
  `gmailMessagesQuerySchema` in `packages/shared`.
- Tests: `gmail.service.test.ts` (12), `gmail-messages.service.test.ts` (11),
  `tests/google-gmail.api.test.ts` (7) — all against mocked `googleapis`,
  never a real Gmail account.

**Not implemented (by design, per scope rules):** email persistence (no
`Email` rows written), signal detection, AI/priority scoring, interventions,
Calendar, background jobs, Redis/queues, SSE, desktop UI changes.

**Verification status:** All 72 API tests pass (was 42 after Phase 2.1),
typecheck and lint clean on `api`/`shared`, manually smoke-tested via `curl`
against the real running API server — confirmed a clean 404 when no Google
connection exists and a clean 400 when `limit` exceeds the safe maximum (25).
Gmail fetch logic itself was verified only against mocked `googleapis`
responses in this session — **no live OAuth + Gmail API call against a real
Google account was performed** (no `GOOGLE_CLIENT_ID`/`SECRET` were available
to complete a real consent flow).

---

## Addendum: Phase 2.1 - Google OAuth Foundation (September 14, 2026)

Implemented the OAuth foundation only — connecting a Google account and
persisting an encrypted refresh token. Gmail/Calendar fetching is explicitly
out of scope and not implemented. Full details: [docs/GOOGLE_OAUTH.md](./docs/GOOGLE_OAUTH.md).

**Added:**
- `Integration.providerAccountId` / `providerAccountEmail` columns + migration
  (`apps/api/prisma/migrations/20260914083021_p21_google_oauth_integration`).
- `apps/api/src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt using `ENCRYPTION_KEY`.
- `apps/api/src/providers/google/oauth/` — `google-oauth.service.ts` (wraps
  `googleapis`' `google.auth.OAuth2`), `state.ts` (signed CSRF state token).
- `apps/api/src/db/repositories/integrations.repository.ts`,
  `apps/api/src/domain/google-connection.service.ts`.
- Routes at `/api/v1/integrations/google/{connect,callback,status,disconnect}`.
- `googleConnectionStatusSchema` in `packages/shared`.
- Minimal "Connect Google" link in the desktop overlay's idle state (opens
  `/connect` in the system browser via `shell.openExternal`).
- Tests: `apps/api/src/lib/crypto.test.ts`,
  `apps/api/src/providers/google/oauth/{state,google-oauth.service}.test.ts`,
  `apps/api/src/domain/google-connection.service.test.ts`,
  `apps/api/tests/google-integration.api.test.ts`.

**Not implemented (by design, per scope rules):** Gmail/Calendar fetching, AI
prioritization, background sync jobs, SSE, Redis/queues, multi-user auth.

**Verification status:** All 42 API tests pass, desktop unit tests pass (one
pre-existing, unrelated failure in `App.test.tsx` — see that file), typecheck
clean on `api` and `desktop`, `prisma migrate dev` applied against the local
Docker Postgres, and the API was manually smoke-tested via `curl` (`/connect`
returns a clean 400 without Google credentials configured; `/status` and
`/disconnect` behave correctly with no tokens ever in the response body).
Real end-to-end OAuth against a live Google account was **not** verified in
this session — that requires a real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
and a human completing the consent screen.

---

---

## Executive Summary

This document tracks all work completed on the AI Executive Agent project, providing a complete context for the next developer to continue development. Phase 1 has been successfully completed with a working prototype that can be tested with demo data.

### Current Status: ✅ Phase 1 Complete

- **Database**: PostgreSQL running in Docker, all migrations applied
- **API**: Fastify server with intervention endpoints working
- **Desktop App**: Electron overlay with Done/Remind Later functionality
- **Demo Data**: 4 test interventions loaded and functional
- **Documentation**: Comprehensive README with troubleshooting guides

---

## Work Completed

### 1. Documentation Updates

#### Files Modified:
- **`README.md`** (root)
  - Added complete "Quick Start - Running with Demo Data" section
  - Step-by-step installation and setup instructions
  - Architecture overview and tech stack details
  - Troubleshooting section for common issues (Windows-specific)
  - Verification checklist with commands
  - Updated implementation order checklist

- **`apps/api/README.md`**
  - Detailed API documentation
  - Available endpoints with examples
  - Database commands reference
  - Environment variables breakdown
  - Architecture diagram

- **`apps/desktop/README.md`**
  - Quick start instructions
  - Demo data explanation
  - Feature walkthrough (intervention cards, actions, workflow)
  - Architecture diagram
  - Development notes

### 2. Environment Configuration Fixes

#### Issue Resolved:
- **Problem**: `.env` file had Windows line endings (CRLF) causing dotenv-cli to fail
- **Solution**: Converted `.env` to Unix line endings (LF)
- **Command used**:
  ```powershell
  $content = Get-Content ".env" -Raw; $content -replace "`r`n", "`n" | Set-Content ".env" -NoNewline
  ```

#### Current `.env` Configuration:
```env
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ai_exec_agent
ENCRYPTION_KEY=cmVwbGFjZV93aXRoX2FfcmVhbF8zMl9ieXRlX2tleV93aGVuX3JlYWR5PQ==
OPENAI_API_KEY=
OPENAI_MODEL=
CRON_SCHEDULE=*/5 * * * *
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/auth/google/callback
APP_BASE_URL=http://localhost:3000
API_BASE_URL=http://localhost:4000
DESKTOP_BASE_URL=http://localhost:3001
```

**Note**: Only `DATABASE_URL` and `ENCRYPTION_KEY` are required for Phase 1 testing.

### 3. Database Setup & Verification

#### Infrastructure:
- **PostgreSQL**: Running in Docker container `ai-executive-agent-blueprint-postgres-1`
- **Port Mapping**: Host 5433 → Container 5432
- **Database Name**: `ai_exec_agent`
- **Credentials**: postgres/postgres

#### Tables Created:
```
public | AgentRun           | table
public | CalendarEvent      | table
public | Email              | table
public | Integration        | table
public | Intervention       | table
public | Signal             | table
public | User               | table
public | _prisma_migrations | table
```

#### Demo Data Loaded:
- **User**: `demo@example.local` (ID: `cmt8mo9wc0000v8zi9ab2teyk`)
- **Interventions** (4 total):
  1. **Critical**: "Launch checklist needs your decision"
  2. **High**: "Approve the Q4 campaign budget"
  3. **Medium**: "Follow up with the product team"
  4. **Low**: "Review this week's notes"

#### Verification Commands:
```powershell
# Check database tables
docker exec ai-executive-agent-blueprint-postgres-1 psql -U postgres -d ai_exec_agent -c "\dt"

# Check demo user
docker exec ai-executive-agent-blueprint-postgres-1 psql -U postgres -d ai_exec_agent -c "SELECT email FROM public.\"User\";"

# Check interventions
docker exec ai-executive-agent-blueprint-postgres-1 psql -U postgres -d ai_exec_agent -c "SELECT title, priority FROM public.\"Intervention\" ORDER BY priority;"
```

### 4. API Development Status

#### Endpoints Implemented:
| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/api/v1/health` | Health check | ✅ Working |
| GET | `/api/v1/ready` | Readiness check | ✅ Working |
| GET | `/api/v1/interventions` | List interventions | ✅ Working |
| GET | `/api/v1/interventions/:id` | Get single intervention | ✅ Working |
| POST | `/api/v1/interventions/:id/done` | Mark as done | ✅ Working |
| POST | `/api/v1/interventions/:id/snooze` | Snooze intervention | ✅ Working |

#### Architecture:
- **Framework**: Fastify 5 with TypeScript
- **Validation**: Zod schemas via `fastify-type-provider-zod`
- **Database**: Prisma ORM
- **Authentication**: Falls back to demo user if no `x-user-id` header provided

#### Key Files:
- `apps/api/src/app.ts` - Fastify app configuration
- `apps/api/src/routes/interventions.ts` - Intervention routes
- `apps/api/src/domain/intervention.service.ts` - Business logic
- `apps/api/src/domain/pipeline.service.ts` - Demo pipeline
- `apps/api/src/domain/signal-engine.ts` - Signal detection logic

#### Running the API:
```powershell
cd apps/api
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/ai_exec_agent"
pnpm dev
```

**API runs at**: `http://localhost:4000`

### 5. Desktop App Development Status

#### Architecture:
- **Framework**: Electron 32 with React 19
- **Build Tool**: Vite 5
- **Styling**: CSS with transparent overlay
- **Communication**: IPC bridge between main and renderer processes

#### Components Implemented:
- **Main Process**: 
  - Window management (transparent, always-on-top overlay)
  - IPC handlers for API communication
  - Position management (bottom-right corner)
  
- **Renderer Process**:
  - `App.tsx` - Main component with state management
  - `InterventionCard.tsx` - Displays intervention details
  - `Character.tsx` - Animated character component
  - `use-intervention-polling.ts` - Polls API every 15 seconds

- **Preload Script**:
  - Exposes `desktopAPI` bridge to renderer
  - Methods: `fetchInbox()`, `markDone()`, `snooze()`, `setInteractive()`

#### Features Working:
✅ Intervention cards display in priority order  
✅ "Done" button marks intervention as resolved  
✅ "Remind me later" snoozes intervention  
✅ Transparent overlay positioned in bottom-right corner  
✅ Mouse events disabled when no intervention visible  
✅ Auto-refresh every 15 seconds

#### Key Files:
- `apps/desktop/src/main/index.ts` - Electron main process
- `apps/desktop/src/main/preload.cjs` - Preload script (CommonJS)
- `apps/desktop/src/main/api-client.ts` - Backend API client
- `apps/desktop/src/main/ipc/register-ipc.ts` - IPC handlers
- `apps/desktop/src/main/windows/overlay-window.ts` - Window setup
- `apps/desktop/src/renderer/App.tsx` - Main React component
- `apps/desktop/src/renderer/bridge.ts` - TypeScript bridge definitions

#### Running the Desktop App:
```powershell
# Terminal 1 - Vite dev server
cd apps/desktop
pnpm dev

# Terminal 2 - Electron (after Vite is ready)
cd apps/desktop
pnpm electron
```

**Note**: The desktop app requires both the API and Vite to be running.

### 6. Shared Package

#### Status: ✅ Implemented

- **Location**: `packages/shared`
- **Purpose**: Shared domain types and Zod schemas
- **Exports**:
  - `inboxResponseSchema` - Response schema for interventions list
  - `interventionDtoSchema` - Single intervention schema
  - `healthResponseSchema` - Health endpoint schema
  - `doneRequestSchema` - Done action schema
  - `snoozeRequestSchema` - Snooze action schema
  - `idParamsSchema` - ID parameter validation

### 7. Testing

#### Tests Implemented:
- `apps/api/tests/demo-pipeline.test.ts` - Pipeline integration test
- `apps/api/tests/interventions.api.test.ts` - API endpoint tests
- `apps/api/src/routes/health.test.ts` - Health check tests
- `apps/desktop/src/main/api-client.test.ts` - API client tests
- `apps/desktop/src/renderer/App.test.tsx` - React component tests

#### Running Tests:
```powershell
# Run all tests
pnpm test

# Run specific test file
pnpm vitest run tests/interventions.api.test.ts
```

### 8. Scripts & Commands Reference

#### Package.json Scripts (root):
```json
{
  "dev": "pnpm -r --parallel dev",
  "build": "pnpm -r build",
  "typecheck": "pnpm -r typecheck",
  "test": "pnpm -r test",
  "lint": "pnpm -r lint",
  "dev:desktop": "pnpm db:demo-tasks && pnpm --filter @ai-agent/desktop exec concurrently \"pnpm --filter @ai-agent/api dev\" \"pnpm --filter @ai-agent/desktop electron:dev\"",
  "db:migrate": "dotenv -e .env -- pnpm --filter @ai-agent/api exec prisma migrate dev",
  "db:seed": "dotenv -e .env -- pnpm --filter @ai-agent/api prisma:seed",
  "db:demo-tasks": "dotenv -e .env -- pnpm --filter @ai-agent/api prisma:demo-tasks",
  "db:studio": "dotenv -e .env -- pnpm --filter @ai-agent/api exec prisma studio"
}
```

#### API Scripts:
```powershell
pnpm dev              # Start dev server with hot reload
pnpm build            # Build for production
pnpm typecheck        # TypeScript type checking
pnpm test             # Run tests
pnpm prisma:migrate   # Run database migrations
pnpm prisma:seed      # Load pipeline demo data
pnpm prisma:demo-tasks # Load desktop demo interventions
pnpm prisma:generate  # Generate Prisma client
pnpm prisma:studio    # Open Prisma Studio GUI
```

#### Desktop Scripts:
```powershell
pnpm dev              # Start Vite dev server
pnpm electron:dev     # Build and start Electron with Vite
pnpm electron         # Start Electron (requires Vite running)
pnpm build            # Build for production
pnpm test             # Run tests
```

---

## Known Issues & Solutions

### Issue 1: Database Authentication Fails

**Problem**: `Authentication failed against database server at localhost`

**Root Cause**: 
- dotenv-cli not loading `.env` file correctly due to Windows line endings (CRLF)
- Prisma client requires DATABASE_URL to be set

**Solution**:
```powershell
# Fix line endings
$content = Get-Content ".env" -Raw; $content -replace "`r`n", "`n" | Set-Content ".env" -NoNewline

# Or set DATABASE_URL explicitly before running commands
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/ai_exec_agent"
```

### Issue 2: "Desktop bridge unavailable" Error

**Problem**: Error message in browser at `http://localhost:5173`

**Root Cause**: Viewing the app in a browser instead of Electron

**Solution**: 
- The `window.desktopAPI` bridge only exists in Electron context
- Run the app via `pnpm electron` command, not in a browser
- The desktop overlay window appears in bottom-right corner

### Issue 3: Port Already in Use (4000 or 5173)

**Problem**: `EADDRINUSE: address already in use`

**Solution**:
```powershell
# Find and kill processes
Get-NetTCPConnection -LocalPort 4000,5173 -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
Stop-Process -Id <process_id> -Force

# Or kill all node processes (be careful)
Get-Process -Name node | Stop-Process -Force
```

### Issue 4: wait-on Timeout When Starting Desktop

**Problem**: `wait-on tcp:127.0.0.1:5173` times out

**Root Cause**: wait-on checks TCP connection which doesn't work reliably with Vite

**Solution**: Run components separately:
```powershell
# Terminal 1
cd apps/desktop
pnpm dev

# Terminal 2 (after Vite is ready)
cd apps/desktop
pnpm electron
```

### Issue 5: Prisma Client Not Generated

**Problem**: `Prisma Client could not be generated`

**Solution**:
```powershell
cd apps/api
pnpm prisma:generate
```

---

## Architecture Decisions

### Decision 1: Monorepo Structure
**Rationale**: Separate apps (api, web, desktop) with shared packages  
**Implementation**: pnpm workspace with `pnpm-workspace.yaml`  
**Trade-offs**: Simpler than Turborepo for Phase 1 scope

### Decision 2: PostgreSQL with Prisma
**Rationale**: Type-safe database access with migrations  
**Alternative Considered**: Drizzle ORM  
**Choice**: Prisma for better TypeScript integration and tooling

### Decision 3: Server-Sent Events (SSE) over WebSocket
**Rationale**: Simpler real-time updates for Phase 1, unidirectional  
**Phase 2**: May upgrade to WebSocket if bidirectional needed  
**Implementation**: Not yet implemented, planned for Phase 2

### Decision 4: node-cron over Redis/BullMQ
**Rationale**: Simple scheduled jobs without infrastructure complexity  
**Phase 2**: May migrate to BullMQ if job reliability becomes critical  
**Implementation**: Not yet implemented, planned for Phase 2

### Decision 5: Electron Overlay Design
**Rationale**: Always-visible intervention cards without blocking workflow  
**Implementation**: Transparent, always-on-top, bottom-right positioned  
**Trade-offs**: Limited screen real estate, requires careful UX design

### Decision 6: Demo User Fallback
**Rationale**: Simplifies testing without OAuth in Phase 1  
**Implementation**: API falls back to `demo@example.local` if no auth header  
**Phase 2**: Remove fallback once OAuth is implemented

---

## Phase 2 Roadmap

### 2.1: Google OAuth Integration
**Estimated Effort**: 3-5 days

**Tasks**:
1. Implement OAuth 2.0 flow with Google
2. Store encrypted refresh tokens in `Integration` table
3. Create `/api/v1/auth/google/*` endpoints
4. Add session management (JWT or session cookies)
5. Update intervention routes to use authenticated user
6. Remove demo user fallback
7. Test with real Google account

**Files to Create/Modify**:
- `apps/api/src/routes/auth.ts` - OAuth endpoints
- `apps/api/src/providers/google/oauth-client.ts` - OAuth client
- `apps/api/src/domain/integration.service.ts` - Integration management
- `apps/api/src/lib/encryption.ts` - Token encryption utilities
- Update `.env` with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

**Dependencies**:
- Google Cloud Console project setup
- OAuth consent screen configuration
- Redirect URI whitelisting

### 2.2: Gmail Connector (Read-Only)
**Estimated Effort**: 5-7 days

**Tasks**:
1. Implement Gmail API client wrapper
2. Create email sync job (fetch recent emails)
3. Store emails in `Email` table
4. Implement incremental sync (track history ID)
5. Add error handling for API rate limits
6. Create job scheduler with node-cron
7. Test with real Gmail data

**Files to Create/Modify**:
- `apps/api/src/providers/google/gmail/client.ts` - Gmail API client
- `apps/api/src/providers/google/gmail/sync.ts` - Email sync logic
- `apps/api/src/jobs/sync-emails.job.ts` - Cron job
- `apps/api/src/domain/email.service.ts` - Email domain logic

**Scopes Required**:
- `https://www.googleapis.com/auth/gmail.readonly`

### 2.3: Google Calendar Connector (Read-Only)
**Estimated Effort**: 3-5 days

**Tasks**:
1. Implement Calendar API client wrapper
2. Create calendar sync job
3. Store events in `CalendarEvent` table
4. Implement incremental sync (sync tokens)
5. Add error handling for recurring events
6. Create job scheduler
7. Test with real calendar data

**Files to Create/Modify**:
- `apps/api/src/providers/google/calendar/client.ts` - Calendar API client
- `apps/api/src/providers/google/calendar/sync.ts` - Event sync logic
- `apps/api/src/jobs/sync-calendar.job.ts` - Cron job
- `apps/api/src/domain/calendar.service.ts` - Calendar domain logic

**Scopes Required**:
- `https://www.googleapis.com/auth/calendar.readonly`

### 2.4: LLM Prioritization
**Estimated Effort**: 5-7 days

**Tasks**:
1. Design prompt template for priority scoring
2. Implement OpenAI API client
3. Create structured output schema with Zod
4. Build signal prioritization service
5. Add cost tracking and rate limiting
6. Store LLM decisions in `AgentRun` table
7. Test with real intervention scenarios

**Files to Create/Modify**:
- `apps/api/src/providers/openai/client.ts` - OpenAI client
- `apps/api/src/agent/prioritization.ts` - Priority scoring logic
- `apps/api/src/agent/prompts.ts` - Prompt templates
- `apps/api/src/domain/agent-run.service.ts` - Agent run tracking

**Requirements**:
- OpenAI API key with sufficient quota
- Model selection (gpt-4o-mini recommended)
- Structured output validation

### 2.5: SSE Real-Time Updates
**Estimated Effort**: 2-3 days

**Tasks**:
1. Add SSE endpoint to Fastify
2. Broadcast intervention changes
3. Update desktop app to connect to SSE
4. Add reconnection logic
5. Handle multiple clients
6. Test with concurrent updates

**Files to Create/Modify**:
- `apps/api/src/routes/sse.ts` - SSE endpoint
- `apps/api/src/lib/events.ts` - Event emitter
- `apps/desktop/src/main/sse-client.ts` - SSE client in main process
- Update IPC handlers to broadcast SSE events

### 2.6: Background Job Scheduler
**Estimated Effort**: 2-3 days

**Tasks**:
1. Set up node-cron scheduler
2. Implement email sync job
3. Implement calendar sync job
4. Implement signal detection job
5. Add job monitoring and logging
6. Create manual trigger endpoints (for testing)
7. Test job execution

**Files to Create/Modify**:
- `apps/api/src/jobs/scheduler.ts` - Job scheduler
- `apps/api/src/jobs/sync-all.job.ts` - Master sync job
- `apps/api/src/jobs/detect-signals.job.ts` - Signal detection
- `apps/api/src/config/cron.ts` - Cron schedules

### 2.7: Testing & Quality Assurance
**Estimated Effort**: 3-5 days

**Tasks**:
1. Add integration tests for OAuth flow
2. Add unit tests for Gmail/Calendar clients
3. Add tests for LLM prioritization
4. Add E2E test for full intervention lifecycle
5. Set up test database fixtures
6. Add test coverage reporting
7. Performance testing

---

## Testing the Current System

### Manual Testing Checklist:

#### 1. Database Verification
```powershell
# Check PostgreSQL is running
docker ps | findstr postgres

# Verify database exists
docker exec ai-executive-agent-blueprint-postgres-1 psql -U postgres -c "\l"

# Check tables
docker exec ai-executive-agent-blueprint-postgres-1 psql -U postgres -d ai_exec_agent -c "\dt"

# Verify demo data
docker exec ai-executive-agent-blueprint-postgres-1 psql -U postgres -d ai_exec_agent -c "SELECT COUNT(*) FROM \"Intervention\";"
```

Expected: 4 interventions, 1 user

#### 2. API Testing
```powershell
# Start API
cd apps/api
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/ai_exec_agent"
pnpm dev

# Test health endpoint (in another terminal)
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/health"

# Test interventions endpoint
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/interventions" | ConvertTo-Json
```

Expected: `{"status":"ok"}` for health, array of 4 interventions

#### 3. Desktop App Testing
```powershell
# Terminal 1 - Start Vite
cd apps/desktop
pnpm dev

# Terminal 2 - Start Electron (after Vite ready)
cd apps/desktop
pnpm electron
```

Expected:
- Transparent overlay window appears in bottom-right corner
- First intervention card shows "Launch checklist needs your decision"
- "Done" button removes card and shows next intervention
- "Remind me later" snoozes intervention

#### 4. End-to-End Workflow Test
1. Start API and Desktop app
2. Verify 4 interventions loaded
3. Click "Done" → intervention disappears, next appears
4. Click "Remind me later" → intervention snoozes
5. Check database: 1 resolved, 1 snoozed
6. Refresh app → snoozed intervention not shown (until snooze expires)

---

## Development Guidelines

### Code Style:
- TypeScript strict mode enabled
- Small modules with explicit inputs/outputs
- Validate external input at every boundary
- Use typed domain errors
- Avoid business logic inside HTTP route handlers

### Git Workflow:
- Commit frequently with descriptive messages
- Use conventional commit format: `feat:`, `fix:`, `docs:`, `test:`
- Create feature branches for Phase 2 work
- PR reviews required before merging

### Testing Requirements:
- Unit tests for priority logic, snooze behavior, connector normalization
- Integration tests for API endpoints
- E2E test for intervention lifecycle
- Minimum 80% code coverage goal

### Security Considerations:
- Never commit secrets or OAuth credentials
- Store refresh tokens encrypted at rest
- Use least-privilege OAuth scopes (read-only for Phase 1)
- Do not log email bodies, OAuth tokens, or sensitive payloads
- Use server-side OAuth for Gmail/Calendar access

---

## Resources & References

### Documentation:
- [Project README](./README.md) - Setup and quick start
- [API README](./apps/api/README.md) - API documentation
- [Desktop README](./apps/desktop/README.md) - Desktop app guide
- [Prisma Schema](./apps/api/prisma/schema.prisma) - Database schema

### External Resources:
- [Fastify Documentation](https://fastify.dev/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Electron Documentation](https://www.electronjs.org/docs)
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API](https://developers.google.com/gmail/api)
- [Google Calendar API](https://developers.google.com/calendar/api)

### Architecture Decisions:
- See `docs/decisions/` directory for ADRs (Architecture Decision Records)
- Create new ADRs for significant Phase 2 decisions

---

## Contact & Support

### Project Context:
- **Repository**: ai-executive-agent-blueprint
- **Phase Completed**: Phase 1 (Foundation)
- **Current Status**: Ready for Phase 2 development

### For Questions:
1. Check this HANDOFF.md document first
2. Review README.md for setup issues
3. Check troubleshooting section for common problems
4. Review code comments in key files
5. Create GitHub issue if blocked

---

## Appendix: Key Code Locations

### Database:
- Schema: `apps/api/prisma/schema.prisma`
- Migrations: `apps/api/prisma/migrations/`
- Seed: `apps/api/prisma/seed.ts`
- Demo data: `apps/api/prisma/create-demo-interventions.ts`

### API Domain Logic:
- Intervention service: `apps/api/src/domain/intervention.service.ts`
- Signal engine: `apps/api/src/domain/signal-engine.ts`
- Pipeline service: `apps/api/src/domain/pipeline.service.ts`

### API Routes:
- Health: `apps/api/src/routes/health.ts`
- Interventions: `apps/api/src/routes/interventions.ts`
- DTOs: `apps/api/src/routes/intervention.dto.ts`

### Desktop App:
- Main process: `apps/desktop/src/main/index.ts`
- Preload: `apps/desktop/src/main/preload.cjs`
- API client: `apps/desktop/src/main/api-client.ts`
- IPC: `apps/desktop/src/main/ipc/register-ipc.ts`
- Window: `apps/desktop/src/main/windows/overlay-window.ts`
- Renderer: `apps/desktop/src/renderer/App.tsx`

### Shared Types:
- Location: `packages/shared/src/`
- Schemas: `packages/shared/src/schemas.ts`

---

**End of Handoff Document**

*Last updated by: AI Agent*  
*Date: September 4, 2026*  
*Next review: After Phase 2.1 completion*
