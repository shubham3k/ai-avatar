# Three-Phase Delivery Plan

## Phase 1 - Working Prototype

### Goal
Prove the core loop end-to-end with the smallest useful system.

### Scope
- One user.
- Gmail read-only.
- Calendar read-only.
- Demo mode.
- Postgres.
- Fastify API.
- Node worker + cron.
- OpenAI structured reasoning.
- Web dashboard.
- Electron overlay.
- Done/Snooze.
- SSE.

### Milestones

#### P1.1 Repo and local environment
- monorepo
- shared package
- Postgres
- Prisma
- environment config

#### P1.2 Web/API skeleton
- health endpoints
- basic dashboard
- API error model
- shared schemas

#### P1.3 Google connection
- OAuth flow
- encrypted refresh token
- Gmail import
- Calendar import

#### P1.4 Domain pipeline
- normalize provider objects
- deterministic signal generation
- agent evaluation
- intervention persistence

#### P1.5 Desktop overlay
- transparent Electron window
- character image
- message card
- Done/Snooze
- SSE connection

#### P1.6 End-to-end validation
Scenario:
1. Demo or live email says approval is needed.
2. Calendar contains launch tomorrow.
3. Worker runs.
4. Signal is created.
5. LLM ranks it high.
6. Intervention is persisted.
7. Desktop overlay appears.
8. User snoozes.
9. Intervention reappears.
10. User resolves it.

### Exit criteria
The full scenario works repeatedly from a clean environment.

---

## Phase 2 - Useful Product

### Goal
Make the system reliable enough for daily personal use.

### Add
- user accounts
- durable sessions
- Redis/BullMQ worker queue
- incremental sync
- Slack integration
- better signal rules
- quiet hours
- notification preferences
- feedback capture
- basic memory/preferences
- intervention history
- analytics
- deployment

### Exit criteria
The assistant runs continuously for a real user with low operational maintenance.

---

## Phase 3 - Agentic Operations Layer

### Goal
Move from attention management into controlled execution.

### Add
- action/tool contracts
- approval policies
- draft email responses
- task creation
- calendar actions
- CRM actions
- structured memory
- personalization
- multi-source relationship/entity graph only if required
- richer character animation
- autonomous workflows with strict guardrails

### Exit criteria
The system can safely complete selected low-risk tasks with explicit user policy and strong auditability.
