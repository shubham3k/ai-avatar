# Step-by-Step Build Guide for Agentic Coding

## Operating rule

Do not ask the coding agent to build the whole application in one prompt. Give it bounded tasks that end in a passing build/test state. OpenAI recommends scoping Codex work similarly to a GitHub issue and using persistent repository instructions such as `AGENTS.md`; Cursor likewise supports project rules and `AGENTS.md`. 

## Step 0 - Bootstrap

Create the workspace and commit the blueprint files before asking the coding agent to write application code.

Expected structure:

```text
ai-executive-agent/
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── .cursor/
│   └── rules/
├── apps/
│   ├── web/
│   ├── api/
│   ├── worker/
│   └── desktop/
├── packages/
│   └── shared/
├── infra/
├── docs/
└── scripts/
```

## Step 1 - Implement the shared contract

Ask the agent to implement:
- enums
- DTOs
- Zod schemas
- intervention event schema
- API response envelope

Do not start OAuth yet.

## Step 2 - Implement database/domain state

Create Prisma schema for:
- User
- Integration
- Email
- CalendarEvent
- Signal
- Intervention
- AgentRun

Run migrations and seed demo data.

## Step 3 - Build the API skeleton

Implement:
- `GET /health`
- `GET /api/v1/interventions`
- `POST /api/v1/interventions/:id/resolve`
- `POST /api/v1/interventions/:id/snooze`
- `GET /api/v1/events/stream`

Keep routes thin. Put business logic in services.

## Step 4 - Build demo mode first

Create a demo scenario that produces:
- a design approval email
- a launch calendar event tomorrow
- a candidate signal

The goal is to prove the reasoning and UI before OAuth complexity.

## Step 5 - Implement provider adapters

Create interfaces:

```text
GmailProvider
  listMessages
  getMessage

CalendarProvider
  listEvents
```

Then implement Google adapters behind those interfaces.

## Step 6 - Implement Google OAuth

Use a server-side OAuth flow. Store only encrypted refresh credentials server-side. Keep Phase 1 scopes read-only.

## Step 7 - Implement sync

Initial sync:
- recent Gmail messages
- upcoming Calendar events

Scheduled sync:
- poll every few minutes during development
- deduplicate by provider object id
- update local records

Do not attempt provider-perfect incremental sync in the first pass.

## Step 8 - Implement signal generation

Start with deterministic rules.

Examples:

```text
reply_needed:
- message appears to request a response
- sender is not the user
- no newer reply from the user exists

upcoming_meeting:
- event starts within configurable window

deadline:
- explicit due phrase or candidate deadline exists
```

The rule layer creates candidates. It does not decide final priority alone.

## Step 9 - Implement AI prioritization

Build one service:

`evaluateSignal(signalId)`

It should:
1. load signal and context
2. build compact prompt context
3. call the LLM
4. validate structured output
5. apply deterministic guards
6. create/update intervention
7. record AgentRun

Use structured output rather than parsing free-form text.

## Step 10 - Build the web dashboard

Minimum screens:
- Today
- Interventions
- Integrations
- Settings

Today should show the same intervention objects that power the desktop overlay.

## Step 11 - Build the Electron shell

Create a separate Electron app with:
- transparent BrowserWindow
- `alwaysOnTop: true`
- `frame: false`
- `skipTaskbar: true`
- preload bridge
- `contextIsolation: true`

The overlay should be small and anchored near the bottom-right corner.

## Step 12 - Character UI

Phase 1 uses a transparent PNG/SVG character.

States:
- hidden
- entering
- idle
- showing
- exiting

Use simple CSS transitions. Do not add Rive yet.

## Step 13 - SSE connection

Desktop connects to:

`GET /api/v1/events/stream`

On `intervention.created`, show the overlay.

Reconnect automatically if disconnected.

## Step 14 - Resolve/Snooze

Desktop sends normal HTTP calls to the API.

Resolve:

`POST /api/v1/interventions/:id/resolve`

Snooze:

`POST /api/v1/interventions/:id/snooze`

with a validated `snoozedUntil`.

## Step 15 - Test the whole loop

Use three layers:

### Unit
- signal rules
- prioritization guards
- snooze scheduling
- schemas

### Integration
- provider normalization
- DB persistence
- intervention service

### E2E
- create demo signal
- run evaluator
- receive SSE event
- render overlay
- click snooze
- verify DB state
- advance clock or trigger reawaken job
- click done

## Step 16 - Only then begin Phase 2

Do not add Slack, Redis, memory, autonomous actions, or multiple agents until the Phase 1 loop is stable.

## Agent prompt template

Use prompts shaped like implementation tickets:

```text
Task: Implement Phase 1.3 Google Calendar read-only adapter.

Read first:
- AGENTS.md
- docs/ARCHITECTURE.md
- docs/DATA_MODEL.md
- docs/SECURITY.md

Requirements:
- implement only the Calendar provider interface and Google adapter
- read-only scope only
- no UI changes
- no new dependencies unless necessary
- preserve existing architecture

Acceptance criteria:
- typecheck passes
- unit tests cover normalization
- provider failures map to typed errors
- no credentials are logged

Before finishing:
- run targeted tests
- run typecheck
- report changed files and any assumptions
```
