# ADR-001: Initial Stack

## Decision

Use Next.js, Fastify, Electron, PostgreSQL/Prisma, Node worker, SSE, Zod, and OpenAI Responses API.

## Rationale

The priority is a working prototype with minimal moving parts. The stack keeps all application code in TypeScript and makes the desktop overlay a first-class application without introducing a second language.

Electron is selected for Phase 1 because it directly supports transparent, always-on-top windows and mouse-event handling required by the overlay. Tauri remains a possible Phase 2 optimization if bundle size becomes a meaningful product concern.

SSE is selected instead of WebSockets because the first product only needs one-way intervention delivery. User actions remain normal HTTP requests.
