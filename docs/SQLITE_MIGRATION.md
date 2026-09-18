# SQLite Migration (Phase 4.1)

Switched the Prisma datasource from PostgreSQL to SQLite so the desktop app
can run standalone — no Docker, no external DB process, no manual
`docker compose up`. This is the first step of Phase 4 (making the app
installable on Windows and Mac).

## What changed

- `apps/api/prisma/schema.prisma`: `datasource db { provider = "sqlite" }`,
  `DATABASE_URL` is now a `file:` path (e.g. `file:./dev.db`), resolved
  relative to `prisma/schema.prisma`'s directory — not the process cwd.
- Migration history was reset (old PostgreSQL SQL migrations are not
  portable to SQLite) — a fresh `p41_sqlite_init` migration is the new
  baseline.
- `docker-compose.yml`'s Postgres service is no longer required to run this
  app. It's left in place (harmless) in case you still want Postgres for
  some other reason, but nothing in `apps/api` depends on it anymore.

## Two real Prisma/SQLite limitations that drove the actual code changes

1. **No native array type.** Prisma's SQLite connector doesn't support
   `String[]` (unlike PostgreSQL). Fields that used to be real arrays —
   `Email.toEmails`, `Email.labels`, `CalendarEvent.attendeeEmails`,
   `Integration.scopes` — are now `String` columns storing JSON-encoded
   text.
2. **No native `Json` type either**, and **no native `enum` support.**
   `CalendarEvent.attendees`, `Signal.importanceHints`,
   `Intervention.actionPayload`, `AgentRun.outputJson` are now nullable
   `String` columns (JSON-encoded). Every enum (`IntegrationProvider`,
   `IntegrationStatus`, `SignalType`, `SignalStatus`, `InterventionStatus`,
   `Priority`) is now a plain `String` column — the allowed values are
   unchanged, just no longer enforced by the database, only by the
   application layer (Zod contracts, and TypeScript literal unions at every
   write site).

## Where the serialization happens — and where it doesn't

**Application code, tests, and routes see no difference.** All four
repositories (`emails.repository.ts`, `calendar-events.repository.ts`,
`integrations.repository.ts`, `interventions.repository.ts`) map at the DB
boundary: `JSON.stringify` on every write, `JSON.parse` (via
`apps/api/src/lib/json-array.ts`'s `encodeStringArray`/`decodeStringArray`
helpers, or an inline parse for object-shaped fields) on every read. Each
repository exports its own domain type (e.g. `Email`, `CalendarEvent`,
`Signal`, `Intervention`, `Integration`) with the real `string[]`/object
shape — these are **not** the raw `@prisma/client` generated types anymore;
callers import them from the repository instead.

The only places that manually `JSON.stringify` are code that writes to
Prisma **directly**, bypassing a repository — `demo-scenario.ts`,
`prisma/create-demo-interventions.ts`, and the handful of integration
tests that seed data via `prisma.email.create(...)` etc. for test setup.

## A real correctness bug this migration would have silently introduced (fixed)

`InterventionsRepository.listInbox` used to `ORDER BY priority DESC` at the
database level, relying on PostgreSQL's enum type sorting by declaration
order (`low < medium < high < critical`). With `priority` now a plain
`String` column, that same `ORDER BY ... DESC` would sort **alphabetically**
(`medium > low > high > critical`) — completely wrong. Fixed by removing
the DB-level priority ordering and sorting in application code by an
explicit rank map instead (`createdAt` stays a real DB-level tiebreak
ordering, since dates sort correctly as strings/numbers either way).
Verified with a real runtime smoke test — `critical > high > medium > low`
now returns in the correct order.

## What did *not* change

- No repository's public method signature changed (same params, same
  return shape) — only their internal implementation and the identity of
  the type they return (repository-owned domain type instead of
  `@prisma/client`'s generated type).
- No route, service, or domain logic changed.
- No test assertions or test behavior changed — only how test fixtures
  construct raw rows that bypass a repository.

## Verification

- `pnpm -r typecheck` and `pnpm -r lint` — clean.
- Full `apps/api` test suite: **464/464 passing** against the isolated
  SQLite test database (`apps/api/test.db`, separate from the dev database).
- Real runtime smoke test: started the API against `dev.db`, ran
  `pnpm prisma:demo-tasks`, confirmed correct priority ordering via
  `GET /interventions`, confirmed `POST /interventions/:id/done` and its
  `actionPayload` JSON round-trip correctly, confirmed `POST /goals` and
  `GET /context/daily` work end-to-end.

## Known limitation carried forward

There is still no in-app settings UI or `safeStorage`-backed secret storage
— `.env` files are still how `DATABASE_URL`/`ENCRYPTION_KEY`/Google/Groq
credentials are configured. That's Phase 4.3/4.4, not this phase.
