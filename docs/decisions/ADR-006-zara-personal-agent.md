# ADR-006: Zara — a Local-First Personal AI Agent

**Status:** Accepted (design discussion Sept 28, 2026; development started Sept 29, 2026 on branch `zara-agent`)
**Supersedes, for the next phase only:** the Phase-1 scope rules in `AGENTS.md` that limit the product to read-only Google scopes and a fixed, non-conversational workflow. Every other `AGENTS.md` rule still applies — notably: LLM calls only in the API layer, LLM output Zod-validated before any state change, and the model never executing arbitrary URLs/SQL/shell/browser actions.

## Context

The app today is a proactive notifier: background Gmail/Calendar sync, deterministic signal detection, one Groq-based prioritization step, reminders (typed or spoken), and a bottom-right overlay (dock + intervention cards). The user wants it to become a personal AI agent — something they can **chat and talk with**, that **remembers**, and that can **act through tools and MCP** — while staying **local-first**.

Constraints found along the way:

- Groq's free plan cannot sustain agent conversations (rejected even single reminder requests: "output tokens per minute: Limit 1000, Requested 2048").
- The app runs entirely on the user's PC (embedded API, local SQLite, no server of ours). There is no cloud component and this ADR does not add one.
- The agent will read untrusted content (emails, documents, web pages, MCP results), so prompt injection is the primary safety risk.

## Decision

### 1. Product principle: local-first, minimum-necessary cloud

- **Stored only on the user's PC:** emails, calendar, chats, memory, notes, documents, search/vector index, activity log, settings, credentials (encrypted via `safeStorage`).
- **Search runs locally** (local embeddings model + SQLite full-text/vector search). The LLM never receives a mailbox or document folder wholesale — only the handful of snippets needed for the current answer.
- **Never sent to any provider and never stored in memory:** passwords, PINs, OTPs, security answers, bank/card numbers, government ID numbers (Aadhaar, PAN, passport); health details unless the user explicitly asks Zara to remember them. A deterministic redaction pass runs before any LLM call.
- OpenAI requests set `store: false`. (OpenAI's API docs, Sept 2026: API data is not used for training by default; abuse-monitoring logs are kept up to 30 days; zero retention requires OpenAI approval.)
- A fully local model (Ollama) remains on the "later" list.

### 2. The brain

| Job | Model (default) | Price at decision time (per OpenAI pricing page, Sept 28, 2026) |
| --- | --- | --- |
| Chat + tool use, background jobs | `gpt-6-luna` | $0.10 in / $0.01 cached in / $0.50 out per 1M tokens |
| Speech → text | `gpt-transcribe` (was `gpt-4o-mini-transcribe` until the user's Hindi/Hinglish test) | ≈ $0.0045 / minute |
| Zara's voice | `gpt-4o-mini-tts` (Windows voices as a free option) | $0.60 / 1M text tokens + $12 / 1M audio tokens |
| Fallback (outage/overload only) | Groq `openai/gpt-oss-120b` + Groq Whisper | ≈ $0.15 / $0.60 per 1M (third-party sources — verify) |

- `gpt-6-luna` was chosen over the cheaper `gpt-5-nano` because the user's requirement is that the model reliably handles multi-step tool use; luna is the cheapest model in OpenAI's current flagship family and supports function calling, structured outputs, streaming, and prompt caching. `gpt-5-nano` and `gpt-6-sol` (upgrade path, ~20× luna) stay selectable in Settings.
- Estimated cost for typical use (50 chats/day, ~100 background calls/day, ~20 voice turns/day): **≈ $5–6 / month**; heavy use ≈ $15–20. The user sets a hard spending cap in the OpenAI dashboard; Settings shows an estimated "usage this month".
- **Fallback rules:** Groq takes over any job (chat with tools included) on OpenAI outage, overload, or rate limit — never on an invalid/rejected OpenAI key (that is reported to the user). Replies produced by the fallback are labelled "answered by backup (Groq)". The Groq key is optional; without it there is no fallback.
- All provider calls stay behind the provider-adapter pattern (`apps/api/src/providers/*`), so models and providers remain swappable.
- Prices change; they are re-verified at implementation time and never hard-coded as facts in UI copy.

### 3. Conversation (Zara)

- The assistant is named **Zara**; tone friendly and concise.
- The dock's 💬 panel grows into a conversation thread (small panel above the dock). All chats are stored permanently; a **New chat** button starts fresh; a 🕘 history list reopens old chats; Zara can recall past chats.
- The panel auto-hides after 30 s of inactivity (configurable); the conversation is kept.
- Type → Zara writes. Speak → Zara speaks (and writes).
- Reminder/email alerts remain separate cards (with the full character); the chat header shows a small Zara avatar.

### 4. Memory and activity log

- Zara decides what is worth remembering (facts about the user, people, preferences) and says so ("Noted: …"). Every fact is editable/deletable from a **Memory** page in Settings or by telling Zara it's wrong.
- Chats are kept forever; Settings offers delete-chat and delete-all.
- **Incognito chat**: not stored, nothing learned.
- **Activity log**: every action Zara takes — reminders, memory writes/deletes, drafts, sends, calendar changes, MCP tool calls, routine runs, and which model answered — timestamped, kept forever (deletable), with undo where the action is reversible.

### 5. Voice

- Global hotkey opens Zara from anywhere; default **Ctrl+Shift+Space**, configurable (Ctrl+Space and Alt+Space avoided: they collide with Windows input-language switching and the window menu).
- Click-to-talk (default) and hands-free (voice-activity detection) — both in Settings. Speaking or typing interrupts Zara's speech immediately.
- English, Hindi, Hinglish; Zara replies in the user's language and script. Voice chosen in Settings with preview.

### 6. Proactive behaviour

- Morning briefing on first unlock of the day (written by default; spoken/both optional; every day by default, weekdays-only optional).
- Pre-meeting summary on the existing 10-minute meeting card (attendees, recent emails with them, open items).
- Follow-up nudges on unanswered sent emails (default 3 days, configurable).
- Promises the user made in sent email ("I'll send it by Friday") are reminded automatically (default the day before at 10:00, or 2 hours before if due today), configurable; every auto-created reminder appears in the activity log.
- Pop-ups are held during full-screen apps, presentations, and video calls; the dock shows a waiting count. Urgent items (meeting about to start, reminders marked important) show a small quiet notice even then.
- End-of-day wrap-up (default 18:00, configurable). Optional quiet hours, off by default.

### 7. Recall

- Sources: synced email and calendar, chat history, memory, notes, and a dedicated documents folder (default `Documents\Zara`; PDF, Word, text, Markdown; auto-indexed on change). Image-only scanned PDFs are out of scope for now.
- Email history: 1 month to start (sync window widened from ~14 days), 3 months if needed.
- Notes are plain Markdown files the user owns; Zara acts on them when useful (e.g. offers a reminder).
- People memory (profiles of frequent contacts) ships as an experimental feature that can be switched off.

### 8. Actions (with approval)

- First actions: email (draft, reply, send) and calendar (create, move, cancel). Requires one Google re-consent adding send, calendar-write, and Drive-read scopes.
- **Every action that leaves the PC shows an approval card** with the exact effect (recipient and text; calendar before/after and who gets notified) and Approve / Edit / Cancel.
- Email sends require a click (never voice approval) and wait **30 s** ("Sending… [Undo]") before actually sending. Own-calendar-only events may be approved by voice.
- A narrow "don't ask again" may be added later for specific repeated actions; **sending email always asks — a permanent rule.**
- Zara never acts because content she read told her to; actions originate only from the user's request. New recipients get a warning on the card. All approvals, edits, and cancellations are logged.
- Writing style: user-provided style guide/samples in Settings, plus learning from sent mail and from the user's edits to drafts.

### 9. MCP

- Zara is an MCP client (official TypeScript SDK). An **Add connection** screen in Settings offers presets and custom servers; tokens are stored encrypted.
- Local servers preferred; Node-based servers run on Electron's bundled Node (no separate install).
- **Strict trust:** every tool starts ask-first, including read-only ones; only the user can mark an individual read-only tool as trusted; tools that change things always ask; destructive tools always ask with a warning; file access is limited to user-chosen folders; instructions found inside tool results are never followed; every call is logged.
- Order: local files → Google Drive (built in via the existing Google connection) → web search (search-provider key) → GitHub → Notion → Slack (may need workspace-admin approval) → browser (last; read-only first — no forms, logins, or submits).

### 10. Routines

- Created in plain language ("every Monday at 9, summarize unanswered emails"). Read-and-report routines run automatically; routines that take an action ask for approval on every run. A Routines list in Settings (pause, edit, delete).
- Learning from behaviour (Done/Snooze/ignore patterns) is postponed; when built it ships with a "What Zara has learned" review/undo page.

## Architecture

```
Electron main   hotkey · tray · idle/lock/full-screen detection · scheduler · MCP client host
Renderer        dock · chat panel · approval cards · intervention cards · Settings pages
Embedded API    agent runtime (loop: model → tool call → validated execution → model)
  providers/    openai (chat, stt, tts) · groq (fallback) · google (existing)
  domain/       tools (static, Zod-typed, risk-tiered) · memory · recall · activity log ·
                approvals · routines · existing signals/reminders pipeline
  db/           SQLite via Prisma (+ FTS5, sqlite-vec) — new tables for conversations,
                messages, memory facts, activity entries, approvals, notes, documents,
                MCP connections, routines
```

- Tools are a static, typed list (no dynamic registry beyond MCP-discovered tools), each with a risk tier: **read** (auto), **local write** (auto, undoable, logged), **external** (approval card). MCP tools are mapped into the same tiers under the strict rules above.
- The agent loop runs in the API layer only; the renderer never sees provider keys.
- Model output is Zod-validated before any tool executes or any state changes.

## Milestones (each ends with tests, typecheck, lint, and a user-tested build on request)

| # | Milestone | Outcome |
| --- | --- | --- |
| 0 ✅ | Housekeeping | Checkpoint commit on `main` (`3a96d64`), branch `zara-agent`, Groq output-token cap (`d96f08a`), clean-PC install test (user) |
| 1 ✅ | Brain | OpenAI key + model picker + usage in Settings; reminders, voice, and prioritization on OpenAI; Groq fallback (`ca77fc2`) |
| 2 ✅ | Chat | Conversation panel, agent loop with read tools + reminder tools, streaming, New chat, history, auto-hide (`94e6181`) |
| 3 ✅ | Memory + activity log | Facts, memory page, incognito, redaction, activity log with undo (`03b4efa`) |
| 4 ✅ | Voice | Hotkey, spoken replies, voice picker, hands-free, interruption, Hindi/Hinglish |
| 5 ✅ | Proactive | Briefings, pre-meeting summary, follow-ups, promises, held pop-ups, wrap-up |
| 6 ✅ | Recall | Local index over email/chats/notes/`Documents\Zara`, notes, people memory (experimental) |
| 7 ✅ | Actions | Google re-consent, approval cards, email send with 30 s undo, calendar actions, writing style |
| 8 ✅ | MCP | Add-connection screen, strict trust, servers in the order above |
| 9 ✅ | Routines | Plain-language routines, Routines page |

Development happens on `zara-agent`; it is merged into `main` when complete.

### Implementation notes (deviations found during M1–M9)

- **`create_reminder` takes the user's own words**, not structured time fields: the tool hands the request to the dedicated reminder parser (`reminder-parsing.service.ts`, ADR-005). Live testing showed the chat model — especially the Groq fallback — filling time fields unreliably (e.g. turning "kal subah 9 baje" into 1,079 relative minutes). A per-message dedupe guard prevents repeated calls creating duplicates.
- **Redaction is enforced at the provider boundary** (`providers/llm/redacting-provider.ts`, wrapping primary and fallback in `createLlmProvider`) rather than per feature, so no AI request can bypass it. Audio sent for transcription can't be redacted; its text output is redacted wherever it's used next.
- **Streaming fallback** only switches to Groq if the primary failed before any text was streamed.
- **`gpt-6-luna` requires `reasoning_effort: "none"`** on Chat Completions for function calling; all OpenAI calls also send `store: false`.
- **Settings is tabbed** (General / Voice / Memory / Activity); the chat auto-hide seconds and the voice preferences live in renderer `localStorage`; the hotkey lives in `config.json` (the main process owns `globalShortcut`).
- **M4 voice:** default OpenAI voice `marin`; the hotkey's first press opens the chat, a press while it's open toggles the mic. Replies are spoken sentence by sentence as they stream (lower latency than waiting for the whole reply). **TTS has no Groq fallback** (Groq's voices can't speak Hindi) — a local Windows voice takes over and the reason is shown once. Hands-free is volume-based voice-activity detection, active only while the chat is open and off after 60 s of quiet — not a wake word, which stays on the later list. Interrupting while Zara speaks needs louder, ≥0.4 s speech so her own voice through speakers doesn't cut her off; headphones avoid the issue.
- **M5 proactive:** "first unlock of the day" is implemented as *the first time after 05:00 the user is at the PC* (unlock, resume, app start, or keyboard/mouse activity within 2 minutes) — a PC left unlocked overnight still gets its briefing when the user sits down, not at 05:00 to an empty room. The briefing and wrap-up are saved as chats ("Morning briefing · Tue 29 Sep") so the user can ask follow-ups; "spoken" reads it aloud without opening the panel. Sent mail (last 14 days, the user's own text trimmed to 4,000 chars) is analysed once per email; **the model reports the kind of deadline, code resolves the date** (same lesson as ADR-005 — live testing showed Groq resolving "by Friday" wrongly 1 in 3 times); "by <weekday>" written on that weekday means the following week. Follow-ups only for sent emails the AI judged to expect a reply, confirmed against the Gmail thread before nudging. Busy detection = Windows' own notification state (full-screen / presentation) + another app using the mic or camera (= call), read by a hidden PowerShell helper every 5 s; urgent = high/critical priority (a meeting within 5 minutes). Settings live in the local DB (`ProactiveSettings`) because both the API and the desktop scheduler need them.
- **After the user's first test:** an explicit "remember…" (incl. Hinglish "yaad rakhna", "mera naam") makes the first model turn `tool_choice: "required"` — the model had replied "I'll remember for this conversation" without saving. Transcription moved to `gpt-transcribe` with `languages: [en, hi]` and a style prompt in the user's chosen script (Settings → Voice: Roman/Hinglish by default, or Devanagari); Groq backup uses `whisper-large-v3`.
- **M6 recall:** no `sqlite-vec` — Prisma can't load SQLite extensions, so embeddings are float32 BLOBs searched by brute-force cosine in JS (fine at this scale: ~10–30 ms). Keywords use SQLite's built-in FTS5, created at runtime (outside Prisma migrations). The local model is `Xenova/multilingual-e5-small` via transformers.js/onnxruntime-node, downloaded on first use (not bundled). Indexing is incremental by content hash and runs in the background on each sync. People profiles are computed on demand, never stored. Notes are Markdown files in `Documents\Zara\Notes`; Zara can write them (`create_note`, undoable). PDF/Word text via `unpdf`/`mammoth`; scanned PDFs are out of scope.
- **M7 actions:** "draft" means an in-app draft on the approval card (not a Gmail draft), so the scope is `gmail.send`, not `gmail.compose`/`modify`. "Voice approval" for own-calendar-only events is implemented as approval in chat (spoken or typed "yes"), via a tool that refuses email and anything that notifies others. A send whose 30 s window elapsed while the app was closed is never sent late — the card asks again. Undo of a cancelled event recreates it (Google can't un-delete). Writing-style learning = the user's notes + 2 samples of their sent mail + their last 3 edits to Zara's drafts, fetched by a tool only when drafting (not sent on every turn).
- **M8 MCP:** only the filesystem server is bundled (runs on Electron's own Node); the other presets run through `npx`, so they need Node.js installed and download on first use — bundling every server would bloat the installer. Google Drive is built in (not MCP), through the existing Google connection. An approved tool call's result reaches Zara with the next (automatic) chat message rather than mid-turn. Risk tiers come from MCP tool annotations when present; unannotated tools are classified by name, and anything unclear is treated as "changes things" (always asks). The browser preset is limited to an allowlist of reading tools.
- **M9 routines:** "action routines ask every run" is enforced by construction — a routine run is the normal agent without any approval tool (and without routine-editing tools), so anything that sends or changes something can only produce approval cards; the run's result arrives as an alert card that opens the report chat. Schedules: daily, weekdays, weekly (chosen days), monthly (day N), once; the model extracts, code computes run times. Missed runs catch up once. Behaviour learning remains postponed.

## Consequences

- The product moves from a fixed pipeline to a conversational agent; `AGENTS.md`'s Phase-1 scope rules are superseded for this phase (to be updated in that file when Milestone 7 introduces write scopes).
- Recurring cost moves from zero (Groq free) to a small paid OpenAI bill, capped by the user.
- Some user content (the minimum per answer) leaves the PC for OpenAI; everything else stays local.
- Safety depends on the approval layer and the "never act on read content" rule being enforced in code, not just prompts — these get dedicated tests.

## Alternatives considered

- **Claude (Anthropic API)** — strongest tool use and native MCP support; not chosen, user preferred OpenAI.
- **Groq paid** — fastest and cheap, less reliable on long tool chains; kept as fallback.
- **Gemini** — cheap/free tier; data-use terms on the free tier conflict with local-first.
- **OpenAI Realtime voice** — lowest latency, higher cost and provider lock-in; the STT → LLM → TTS pipeline was chosen, Realtime left as a later upgrade.
- **Fully local (Ollama) as the main brain** — best privacy, clearly weaker tool use today; kept as a later privacy mode.
