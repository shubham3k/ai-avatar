# How to Run the AI Executive Agent Project

This guide walks you through setting up and running all components of the AI Executive Agent Blueprint.

## Prerequisites

Before starting, ensure you have installed:

- **Node.js**: v22.0.0 or higher
  - Download from: https://nodejs.org/
  - Verify: `node --version`

- **pnpm**: v11.22.0 or compatible
  - Install globally: `npm install -g pnpm`
  - Verify: `pnpm --version`

- **Docker Desktop**: For PostgreSQL database
  - Download from: https://www.docker.com/products/docker-desktop
  - Verify: `docker --version`

- **Git**: For version control
  - Download from: https://git-scm.com/

## Project Structure Overview

```
ai-executive-agent-blueprint/
├── apps/
│   ├── api/              # Fastify backend API
│   ├── desktop/          # Electron desktop application
│   ├── web/              # Next.js web application
│   └── worker/           # Node.js job worker
├── packages/
│   └── shared/           # Shared types and schemas
├── infra/                # Infrastructure configuration
├── docs/                 # Documentation
├── docker-compose.yml    # PostgreSQL setup
├── .env                  # Environment variables
└── pnpm-workspace.yaml   # Workspace configuration
```

---

## Step 1: Clone and Setup

```bash
# Navigate to the project directory
cd d:\ai-executive-agent-blueprint

# Install all workspace dependencies
pnpm install

# Verify installation
pnpm --version
node --version
```

---

## Step 2: Configure Environment

The project uses a `.env` file for configuration. A default is already in place, but verify the settings:

```bash
# View current configuration
cat .env
```

**Key variables to check:**
```
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ai_exec_agent
API_BASE_URL=http://localhost:4000
APP_BASE_URL=http://localhost:3000
DESKTOP_BASE_URL=http://localhost:3001
```

**Important**: The DATABASE_URL uses port **5433** (Docker), not 5432 (native PostgreSQL).

---

## Step 3: Start PostgreSQL Database

Open a new PowerShell terminal and start PostgreSQL via Docker:

```bash
cd d:\ai-executive-agent-blueprint

# Start PostgreSQL container
docker-compose up -d postgres

# Verify it's running
docker-compose ps
```

Expected output: `postgres` container should show `Up`

**Verify connection:**
```bash
Test-NetConnection localhost -Port 5433
```

---

## Step 4: Run Database Migrations and Seed

Initialize the database schema and populate with demo data:

```bash
# From project root
cd d:\ai-executive-agent-blueprint

# Run migrations
pnpm db:migrate

# Seed demo data
pnpm db:seed

```

Expected output:
```
Demo setup complete:
  signal created:       false
  intervention created: false
```

The demo data persists idempotently (safe to run multiple times).

To add four local tasks for testing the Electron avatar and queue behavior:
```bash
pnpm db:demo-tasks
```

This creates critical, high, medium, and low priority tasks for
`demo@example.local`. The desktop app shows the critical task first; click
**Done** to move through the remaining tasks. Running the command again resets
these fixtures to pending, so it is safe to repeat during testing.

---

## Step 5: Start the API Server

Open a new PowerShell terminal and start the Fastify API:

```bash
cd d:\ai-executive-agent-blueprint

# Start API in dev mode (with hot reload)
pnpm --filter @ai-agent/api dev
```

Expected output:
```
API server running on http://0.0.0.0:4000
Server listening at http://127.0.0.1:4000
```

**Verify API is working:**
```bash
# In another terminal
Invoke-RestMethod http://localhost:4000/api/v1/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2026-09-01T...",
  "service": "api"
}
```

---

## Step 6: Start the Desktop Application (Electron)

Open a new PowerShell terminal and start the API and Electron together:

```bash
cd d:\ai-executive-agent-blueprint

# Refresh dummy tasks, start the API, and launch Electron
pnpm dev:desktop
```

Expected output:
```
VITE v5.4.21 ready in 520 ms
➜  Local:   http://localhost:5173/
```

The command refreshes the dummy tasks before starting the API. The Electron
window should automatically open. If you run `electron:dev` directly instead,
run `pnpm db:demo-tasks` first and ensure the API is already running.

The desktop app will:
1. Connect to the API at `http://localhost:4000`
2. Fetch interventions from the database
3. Display a character-based UI for managing interventions

---

## Step 7: (Optional) Start the Web Application

Open a new PowerShell terminal to run the Next.js web app:

```bash
cd d:\ai-executive-agent-blueprint

# Start web server
pnpm --filter @ai-agent/web dev
```

Access at: `http://localhost:3000`

---

## Step 8: (Optional) Start the Worker Service

For job scheduling and background tasks, open a new PowerShell terminal:

```bash
cd d:\ai-executive-agent-blueprint

# Start worker
pnpm --filter @ai-agent/worker dev
```

The worker runs cron jobs defined in `.env` (`CRON_SCHEDULE=*/5 * * * *`).

---

## Testing the Application

### Test Interventions API

```bash
# Get all pending interventions
Invoke-RestMethod http://localhost:4000/api/v1/interventions

# Mark intervention as Done
$id = "cmt8mo9xq0008v8zivmrgri28"
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/interventions/$id/done" `
  -Method Post -ContentType "application/json" -Body '{}'

# Snooze intervention for 60 minutes
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/interventions/$id/snooze" `
  -Method Post -ContentType "application/json" -Body '{"minutes": 60}'
```

### Verify Database Changes

Open Prisma Studio to inspect the database:

```bash
# In a new terminal
pnpm --filter @ai-agent/api prisma:studio
```

Access at: `http://localhost:5555`

Browse tables to see:
- Users
- Emails
- Calendar Events
- Signals
- Interventions

---

## Troubleshooting

### PostgreSQL Connection Error
```
Error: Authentication failed for user "postgres"
```
**Solution**: Ensure port 5433 is used (not 5432). Check `.env` DATABASE_URL.

### EPERM Error
```
Error: EPERM: operation not permitted
```
**Solution**: This is resolved by using Docker PostgreSQL. Restart with `docker-compose up -d postgres`.

### Electron Window Doesn't Appear
The window may be starting in the background. Check:
```bash
# Verify Electron processes
Get-Process node
```

Manually click the Electron icon in the taskbar.

### API Port Already in Use
```bash
# Kill process on port 4000
netstat -ano | findstr :4000
taskkill /PID <PID> /F
```

### Vite Dev Server Error
```bash
# Clear node_modules and reinstall
rm -r node_modules
pnpm install
pnpm --filter @ai-agent/desktop electron:dev
```

### Desktop Port 5173 Already in Use
If Vite reports that port 5173 is already in use, find and stop the process holding it:
```powershell
$connection = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($connection) { taskkill /PID $connection.OwningProcess /T /F }
pnpm --filter @ai-agent/desktop electron:dev
```

---

## Full Development Workflow

For a complete development setup with all services, use one terminal per service:

**Terminal 1 - PostgreSQL** (if not already running)
```bash
docker-compose up postgres
```

**Terminal 2 - API**
```bash
pnpm --filter @ai-agent/api dev
```

**Terminal 3 - Electron Desktop**
```bash
pnpm --filter @ai-agent/desktop electron:dev
```

**Terminal 4 - Web (Optional)**
```bash
pnpm --filter @ai-agent/web dev
```

**Terminal 5 - Worker (Optional)**
```bash
pnpm --filter @ai-agent/worker dev
```

---

## Build for Production

### Build All Packages
```bash
pnpm build
```

### Type Check
```bash
pnpm typecheck
```

### Run Tests
```bash
pnpm test
```

### Lint Code
```bash
pnpm lint
```

---

## Useful Commands

```bash
# Install dependencies
pnpm install

# Run development servers (all apps in parallel)
pnpm dev

# Type check
pnpm typecheck

# Run tests
pnpm test

# Lint code
pnpm lint

# Build for production
pnpm build

# Database commands
pnpm db:migrate       # Run migrations
pnpm db:seed          # Seed demo data
pnpm db:studio        # Open Prisma Studio

# Docker commands
docker-compose up -d postgres      # Start database
docker-compose down                # Stop all services
docker-compose ps                  # View running containers
```

---

## Environment Variables Reference

```env
# Application
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ai_exec_agent

# Ports
API_BASE_URL=http://localhost:4000
APP_BASE_URL=http://localhost:3000
DESKTOP_BASE_URL=http://localhost:3001

# Security (dev only)
ENCRYPTION_KEY=cmVwbGFjZV93aXRoX2FfcmVhbF8zMl9ieXRlX2tleV93aGVuX3JlYWR5PQ==

# OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/auth/google/callback

# Job Scheduling
CRON_SCHEDULE=*/5 * * * *

# LLM (optional)
OPENAI_API_KEY=
OPENAI_MODEL=
```

---

## Docker PostgreSQL Details

The project uses Docker for PostgreSQL to ensure consistency across environments.

**docker-compose.yml configuration:**
```yaml
postgres:
  image: postgres:17
  environment:
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
    POSTGRES_DB: ai_exec_agent
  ports:
    - "5433:5432"  # Host:Container
```

**Why port 5433?**
- Port 5432 is commonly used by native PostgreSQL installations
- Port 5433 avoids conflicts and allows both to coexist

---

## Next Steps

Once the project is running:

1. **Explore the API**: Visit `http://localhost:4000/api/v1/health`
2. **Check Interventions**: Get pending interventions and test state changes
3. **Try the Desktop App**: See interventions in the Electron UI
4. **Review the Code**: Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
5. **Read the PRD**: Understand requirements in [docs/PRD.md](docs/PRD.md)

---

## Support

For issues or questions:
- Check [PHASE-1-4-VERIFICATION-REPORT.md](PHASE-1-4-VERIFICATION-REPORT.md) for integration details
- Review [docs/BUILD_GUIDE.md](docs/BUILD_GUIDE.md) for implementation guidance
- See [AGENTS.md](AGENTS.md) for project principles and architecture rules
