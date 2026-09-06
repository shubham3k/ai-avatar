# API

Fastify application providing the backend for the AI Executive Agent.

## Running the API

### Development Mode

```bash
# From project root
pnpm --filter @ai-agent/api dev

# Or from this directory
pnpm dev
```

The API runs at `http://localhost:4000`.

### Available Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check endpoint |
| GET | `/api/v1/interventions` | List interventions for a user |
| PATCH | `/api/v1/interventions/:id` | Update intervention (status, snooze) |

### Query Parameters

**GET /api/v1/interventions**
- `userId` (required): User ID or email (e.g., `demo@example.local`)

**PATCH /api/v1/interventions/:id**
- Body: `{ "status": "resolved" | "dismissed", "snoozedUntil": "ISO date string" }`

## Database Commands

```bash
# Run migrations
pnpm prisma:migrate

# Generate Prisma Client
pnpm prisma:generate

# Load pipeline demo data (email + calendar + signal + intervention)
pnpm prisma:seed

# Load desktop demo interventions (4 test interventions)
pnpm prisma:demo-tasks

# Open Prisma Studio
pnpm prisma:studio
```

## Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm vitest run tests/interventions.api.test.ts
```

## Architecture

```text
src/
  config/
    env.ts           # Environment configuration
    load-env.ts      # Environment loading
  db/
    repositories/
      interventions.repository.ts
  demo/
    demo-scenario.ts # Demo data fixtures
  domain/
    intervention.service.ts
    pipeline.service.ts
    signal-engine.ts
  lib/
    errors.ts
    prisma.ts
  routes/
    health.ts
    interventions.ts
    intervention.dto.ts
  app.ts
  index.ts
```

## Environment Variables

Required for demo/testing:
- `DATABASE_URL`: PostgreSQL connection string
- `ENCRYPTION_KEY`: Base64-encoded 32-byte key

Required for full functionality:
- `OPENAI_API_KEY`: OpenAI API key
- `OPENAI_MODEL`: Model to use (e.g., `gpt-4o-mini`)
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `GOOGLE_REDIRECT_URI`: OAuth callback URL
