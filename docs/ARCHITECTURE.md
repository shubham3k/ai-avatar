# System Architecture

## 1. High-level architecture

```text
                     +-----------------------+
                     |      Next.js Web      |
                     | dashboard + settings |
                     +-----------+-----------+
                                 |
                            HTTPS / REST
                                 |
                     +-----------v-----------+
                     |      Fastify API      |
                     | auth / domain / SSE   |
                     +----+-------------+----+
                          |             |
                    Prisma ORM          | LLM
                          |             v
                    +-----v-----+   +--------+
                    | Postgres  |   | OpenAI |
                    +-----+-----+   +--------+
                          |
                   scheduled sync/jobs
                          |
                   +------v------+
                   | Node Worker |
                   | node-cron   |
                   +------+------+ 
                          |
                +---------+---------+
                |                   |
          +-----v-----+       +-----v------+
          | Gmail API |       | Calendar   |
          | read-only |       | API read-only
          +-----------+       +------------+

                         SSE
                          |
                 +--------v---------+
                 | Electron Desktop |
                 | transparent      |
                 | always-on-top    |
                 +--------+---------+
                          |
                     character UI
```

## 2. Why this architecture

- One backend owns business state.
- The worker owns scheduled ingestion and reasoning jobs.
- The desktop app is deliberately thin.
- PostgreSQL is the source of truth.
- SSE is enough for one-way intervention delivery in Phase 1.
- Provider adapters isolate Google APIs from the domain layer.

## 3. Request/data flow

### First connection

1. User opens web app.
2. User starts Google OAuth.
3. API handles server-side OAuth and stores encrypted refresh token.
4. User triggers initial sync.
5. Worker fetches Gmail/Calendar data.
6. Data is normalized and persisted.

### Proactive intervention

1. Worker runs on schedule.
2. New/changed data is fetched.
3. Deterministic signal rules identify candidates.
4. Context builder gathers related email, calendar event, user goal, and existing task state.
5. LLM returns strict structured prioritization.
6. Backend validates and stores intervention.
7. API publishes an intervention over SSE.
8. Desktop overlay renders it.
9. User selects Done or Snooze.
10. Backend updates the intervention and related task state.

## 4. Boundaries

### Web

Presentation only. It calls the API and never talks directly to Google or the LLM.

### API

Owns authentication/session, domain operations, read APIs, intervention actions, and SSE.

### Worker

Owns polling/sync, normalization, candidate generation, AI reasoning, and scheduled snooze expiration.

### Desktop

Owns native window behavior, animation, rendering, and forwarding user actions to the API.

### Shared package

Owns enums, DTOs, Zod schemas, and event types shared by web/API/desktop.

## 5. Desktop overlay design

The Electron window should be:
- frameless
- transparent
- always on top
- skipped from the taskbar
- positioned near a screen corner
- optionally mouse-pass-through when idle

When an intervention is visible, mouse events must be enabled so the buttons are interactive. Electron supports transparent windows, always-on-top behavior, and toggling mouse-event handling via `setIgnoreMouseEvents`. See the official BrowserWindow documentation for platform-specific behavior. 

## 6. Phase 1 simplifications

Do not add a message broker. Do not add a vector DB. Do not add WebSockets. Do not add a separate microservice for AI. Do not introduce a multi-agent graph.
