# AI Executive Agent - Engineering Blueprint

This repository is the implementation blueprint for a three-phase AI executive/personal operations agent with a proactive desktop character overlay.

> **📋 New Developer?** Start with the [HANDOFF.md](./HANDOFF.md) document for complete context on what's been completed and what's next.

## Product goal

Build a system that connects to a user's work systems, detects what actually needs attention, reasons over the relevant context, and proactively presents a concise intervention through a web dashboard and a desktop overlay.

Phase 1 is intentionally small: single user, Gmail read-only, Google Calendar read-only, AI prioritization, and a desktop overlay with `Done` and `Remind me later`.

## Non-goals for Phase 1

- Multi-agent architecture
- Autonomous outbound actions
- Slack/CRM/Notion integrations
- Mobile apps
- Vector database as the primary store
- Kubernetes or microservices
- Complex event streaming infrastructure
- Voice assistant

## Repo principles

1. Keep business state in a local database (SQLite, via Prisma — see `docs/SQLITE_MIGRATION.md`).
2. Keep external-provider data normalized and traceable to its source.
3. LLMs produce structured decisions, not arbitrary application side effects.
4. All write actions require deterministic backend validation.
5. The desktop client is a presentation/action surface, not the agent brain.
6. Prefer simple polling/scheduled jobs in Phase 1; introduce a queue only when reliability requires it.
7. Every significant agent decision is observable and auditable.

---

## Quick Start - Running with Demo Data

This section will help you get the project running with demo data to verify everything works before moving to Phase 2 development.

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 11.22.0 (install with: `npm install -g pnpm`)
- **Git**

No database server to install or run — the app uses an embedded SQLite
database (a local file, created automatically by `pnpm db:migrate`). See
[docs/SQLITE_MIGRATION.md](./docs/SQLITE_MIGRATION.md) if you're coming
from an older checkout that used PostgreSQL.

### Step 1: Clone and Install Dependencies

```bash
git clone <your-repo-url>
cd ai-executive-agent-blueprint
pnpm install
```

### Step 2: Configure Environment Variables

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
NODE_ENV=development
DATABASE_URL=file:./dev.db
# Generate a 32-byte key: openssl rand -base64 32
ENCRYPTION_KEY=your_actual_32_byte_base64_key_here
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=qwen/qwen3-32b
CRON_SCHEDULE=*/5 * * * *
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/integrations/google/callback
APP_BASE_URL=http://localhost:3000
API_BASE_URL=http://localhost:4000
DESKTOP_BASE_URL=http://localhost:3001
```

**Note:** For demo/testing purposes, you only need:
- `DATABASE_URL` (a `file:` path — the default `file:./dev.db` is fine)
- `ENCRYPTION_KEY` (any base64-encoded 32-byte string)

Google OAuth and Groq keys are **not required** for testing with demo data.

### Step 3: Set Up the Database

Run migrations to create the database schema:

```bash
pnpm db:migrate
```

This will:
- Create all necessary tables (users, integrations, emails, calendar_events, signals, interventions, agent_runs)
- Set up indexes and constraints

### Step 4: Load Demo Data

The project includes two types of demo data:

#### Option A: Desktop App Demo Interventions (Recommended)

Load test interventions specifically designed for the desktop overlay:

```bash
pnpm db:demo-tasks
```

This creates:
- A demo user (`demo@example.local`)
- 4 sample interventions with varying priorities:
  1. **Critical**: Launch checklist decision needed
  2. **High**: Q4 campaign budget approval
  3. **Medium**: Follow up with product team
  4. **Low**: Weekly notes review

These interventions appear in the desktop app in priority order and can be tested with the Done/Remind Later workflow.

#### Option B: Pipeline Demo Data

Alternatively, run the full pipeline demo that simulates signal detection:

```bash
pnpm db:seed
```

This creates:
- A demo user (`demo@example.local`)
- A demo email about "Final approval needed for launch assets"
- A demo calendar event for "Product Launch"
- A detected signal from the email + calendar context
- A generated intervention

### Step 5: Verify the API Works

Start the API server:

```bash
cd apps/api
pnpm dev
```

The API will run at `http://localhost:4000`.

**Test the API:**

```bash
# Health check (using PowerShell)
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/health"

# Or using curl (if available)
curl http://localhost:4000/api/v1/health

# List interventions (get user ID from database first)
# Option 1: Use Prisma Studio
pnpm db:studio
# Then copy the user ID

# Option 2: Query the SQLite file directly (from apps/api)
sqlite3 dev.db "SELECT id FROM User LIMIT 1;"

# Then query interventions
curl "http://localhost:4000/api/v1/interventions?userId=<user_id>"
```

Expected response should include your demo interventions.

### Step 6: Run the Desktop App (Recommended)

The desktop app provides the best visualization of the demo data:

**Important:** Run the API and desktop app separately in two terminals:

**Terminal 1 - Start the API:**
```bash
cd apps/api
pnpm dev
```

Wait for the message: `Server listening at http://127.0.0.1:4000`

**Terminal 2 - Start the desktop app:**
```bash
cd apps/desktop
pnpm electron:dev
```

This will:
1. Compile TypeScript
2. Copy the preload script
3. Start Vite dev server on port 5173
4. Wait for the server to be ready
5. Launch Electron with the desktop overlay

**What you should see:**
- A desktop overlay window (transparent, positioned in bottom-right corner)
- Intervention cards displayed in priority order
- Each card shows title, message, and priority
- "Done" and "Remind me later" buttons work

**Testing the workflow:**
1. Click "Done" on an intervention → it disappears from the list
2. Next intervention appears automatically
3. Click "Remind me later" → intervention snoozes and reappears later

**Troubleshooting:**
- If you see "Desktop bridge unavailable" in a browser at `http://localhost:5173`, that's normal - the desktop bridge only works inside Electron, not in a regular browser
- Make sure you're viewing the app in the Electron window, not a browser
- Check that both the API (port 4000) and Vite (port 5173) are running

### Step 7: View Data in Prisma Studio (Optional)

Inspect your database visually:

```bash
pnpm db:studio
```

Opens Prisma Studio at `https://localhost:5555` where you can:
- View all users, interventions, signals
- Edit records manually
- See relationships between entities

---

## Architecture Overview

### Monorepo Structure

```
ai-executive-agent-blueprint/
├── apps/
│   ├── api/          # Fastify + TypeScript backend
│   ├── web/          # Next.js web dashboard
│   └── desktop/      # Electron overlay app
├── packages/
│   └── shared/       # Shared domain types and Zod schemas
├── docs/
│   └── decisions/    # Architecture decision records
└── prisma/           # Database schema and migrations
```

### Tech Stack

- **Web**: Next.js 15 + React 19 + TypeScript
- **API**: Fastify 5 + TypeScript + Prisma
- **Desktop**: Electron + React + TypeScript
- **Database**: SQLite with Prisma ORM (embedded, no server process — Phase 4.1)
- **Real-time**: Server-Sent Events (SSE)
- **Jobs**: node-cron (Phase 1)

### Key Domain Concepts

1. **User**: Single user account (Phase 1)
2. **Integration**: Google OAuth connection
3. **Email/CalendarEvent**: Normalized external data
4. **Signal**: Detected item requiring attention
5. **Intervention**: Actionable notification presented to user
6. **AgentRun**: Audit trail of LLM decisions

---

## Development Commands

```bash
# Install dependencies
pnpm install

# Run all apps in development (API + Web + Desktop)
pnpm dev

# Build all apps
pnpm build

# Type check all apps
pnpm typecheck

# Run all tests
pnpm test

# Lint all code
pnpm lint

# Database commands
pnpm db:migrate      # Run migrations
pnpm db:seed         # Load pipeline demo data
pnpm db:demo-tasks   # Load desktop demo interventions
pnpm db:studio       # Open Prisma Studio

# Desktop-specific (includes API + demo data)
pnpm dev:desktop     # Run desktop app with demo data
```

---

## Testing Strategy

### Unit Tests

Tests for priority logic, snooze behavior, and connector normalization:

```bash
pnpm test
```

### End-to-End Test

Smoke test for the intervention lifecycle:

```bash
cd apps/api
pnpm test
```

This verifies:
- Signal detection from email/calendar context
- Intervention creation
- Status updates (pending → resolved/snoozed)
- API endpoints

---

## Troubleshooting

### Database Connection Issues

**Error:** `Unable to open the database file` or migrations failing

**Solution:**
- Check `DATABASE_URL` in `.env` is a `file:` path (e.g. `file:./dev.db`), not a leftover PostgreSQL connection string
- Run `pnpm db:migrate` from `apps/api` if the file doesn't exist yet
- **Windows users**: Convert `.env` file to Unix line endings:
  ```powershell
  $content = Get-Content ".env" -Raw; $content -replace "`r`n", "`n" | Set-Content ".env" -NoNewline
  ```

**Note:** As of Phase 4.1, this project uses an embedded SQLite database — no Docker/Postgres required. See [docs/SQLITE_MIGRATION.md](./docs/SQLITE_MIGRATION.md).

### Prisma Client Issues

**Error:** `Prisma Client could not be generated`

**Solution:**
```bash
cd apps/api
pnpm prisma:generate
```

### Demo Data Not Loading

**Error:** `User not found` or empty interventions list

**Solution:**
1. Ensure migrations ran: `pnpm db:migrate`
2. Run demo data loader: `pnpm db:demo-tasks`
3. Verify in Prisma Studio: `pnpm db:studio`

### Desktop App Won't Start

**Error:** Electron fails to launch

**Solution:**
- Install Electron dependencies: `cd apps/desktop && pnpm install`
- Ensure API is running on port 4000
- Check that demo data is loaded

---

## Next Steps

Once you've verified the demo data works:

1. **Test the full workflow**: Done/Remind Later in desktop app
2. **Review the API endpoints**: Check `apps/api/src/routes/`
3. **Understand the domain logic**: Review `apps/api/src/domain/`
4. **Check signal detection**: See `apps/api/src/domain/signal-engine.ts`
5. **Review Prisma schema**: Check `apps/api/prisma/schema.prisma`

**Phase 2 Development:**
- Add Google OAuth integration
- Implement Gmail/Calendar connectors
- Add LLM prioritization
- Implement SSE real-time updates
- Add background job scheduling

---

## Verification Checklist

After following the Quick Start, verify:

- [ ] Database migrations ran successfully
- [ ] Demo data loaded (4 interventions created)
- [ ] API health check returns `{"status":"ok"}`
- [ ] API interventions endpoint returns 4 items
- [ ] Desktop app launches and shows intervention cards
- [ ] "Done" button removes intervention
- [ ] "Remind me later" snoozes intervention

**Quick verification commands:**

```powershell
# 1. Check database has tables (from apps/api)
sqlite3 dev.db ".tables"

# 2. Check demo user exists
sqlite3 dev.db "SELECT email FROM User;"

# 3. Check interventions loaded (priority is app-sorted, not DB-sorted — see docs/SQLITE_MIGRATION.md)
sqlite3 dev.db "SELECT title, priority FROM Intervention;"

# 4. Test API health
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/health"
```

---

## Recommended Implementation Order

1. ✅ Create the monorepo and local infrastructure
2. ✅ Implement the domain model and persistence
3. ⏭ Implement Google OAuth and read-only Gmail/Calendar connectors
4. ⏭ Implement normalization and sync jobs
5. ⏭ Implement deterministic signal extraction
6. ⏭ Implement LLM prioritization with strict structured output
7. ⏭ Implement interventions and snoozing
8. ✅ Implement the Electron overlay
9. ⏭ Wire backend events to the desktop client with SSE
10. ✅ Test the full flow with seeded/demo data
