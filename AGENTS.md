# Project Instructions

## Mission
Build a simple, production-minded AI executive agent in three phases. Do not expand scope without an explicit requirement.

## Architecture rules
- Use a pnpm workspace monorepo; do not add Turborepo unless build performance later justifies it.
- Web: Next.js + TypeScript.
- API: Fastify + TypeScript.
- Desktop: Electron + React + TypeScript.
- DB: SQLite with Prisma (Phase 4.1 — switched from PostgreSQL so the desktop app is self-contained, no Docker/external DB process required; see `docs/SQLITE_MIGRATION.md`).
- Phase 1 jobs: a dedicated Node worker using node-cron. Do not add Redis/BullMQ until Phase 2.
- Phase 1 real-time delivery: Server-Sent Events (SSE), not WebSocket.
- Shared domain types and Zod schemas live in `packages/shared`.
- LLM calls happen only in the API/worker layer. Never expose provider API keys to web or desktop.
- LLM output must be validated by Zod before any state change.
- Do not let the model directly execute arbitrary URLs, SQL, shell commands, or browser actions.
- External APIs are wrapped behind provider-specific adapters.

## Scope discipline
- Phase 1 is a working prototype, not a platform.
- Prefer one well-tested implementation over configurable abstractions.
- Avoid generic frameworks, plugin systems, or dynamic registries unless a real requirement exists.
- Do not build multiple autonomous agents in Phase 1.
- Read-only Google scopes only in Phase 1. Since ADR-006 M7 (Zara), the app also requests `gmail.send`, `calendar.events` and `drive.readonly`, and since ADR-006 §8a `chat.messages.create`, `chat.messages.readonly`, `chat.spaces.readonly`, `chat.spaces.create` and `directory.readonly` (Google Chat); every use of a write scope goes through an approval card the user clicks (email and Google Chat messages: always a click, then a 30 s undo window). The model can only propose actions, never execute them.

## Code quality
- TypeScript strict mode.
- Small modules with explicit inputs/outputs.
- Validate external input at every boundary.
- Use typed domain errors.
- Avoid business logic inside HTTP route handlers.
- Add unit tests for priority logic, snooze behavior, and connector normalization.
- Add an end-to-end smoke test for the intervention lifecycle.

## Agent workflow
- Before editing, inspect the relevant files and current architecture docs.
- Implement one bounded task at a time.
- After each task run typecheck, lint, tests, and the relevant build.
- Do not rewrite unrelated code.
- If an architectural decision is required, update `docs/decisions/` before implementation.
- Never silently change product scope.

## Security
- Never commit secrets or OAuth credentials.
- Store refresh tokens encrypted at rest.
- Use least-privilege OAuth scopes.
- Do not log email bodies, OAuth tokens, or sensitive payloads in production logs.
- Use server-side OAuth for Gmail/Calendar access.
