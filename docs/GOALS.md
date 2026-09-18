# Goals & Commitments (Phase 3.4)

A deliberately minimal, user-owned way to tell the assistant "here's what I
actually care about right now" — not a task/project management system.

## Data model

```prisma
model Goal {
  id          String   @id @default(cuid())
  userId      String
  title       String
  description String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

That's the entire model. No hierarchy, no sub-goals, no progress field, no
due date, no priority, no linkage to specific signals/interventions. A goal
is just a title, an optional description, and whether it's currently active.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/goals` | Create a goal (`{title, description?}`) |
| `GET` | `/api/v1/goals` | List goals — active only by default, `?includeInactive=true` for all |
| `PATCH` | `/api/v1/goals/:id` | Update `title`/`description`/`active` (deactivate via `active: false`) |

There is no `DELETE` — deactivating (`active: false`) is the only lifecycle
transition, matching "keep it simple" from the phase brief. A goal a user no
longer cares about just stops appearing in AI context and default listings;
its history isn't destroyed.

Validation (`apps/api/src/domain/goals.service.ts`): title is required,
trimmed, ≤200 chars; description is optional, trimmed, ≤2000 chars, empty
string normalizes to `null`.

## How goals reach the AI — no new pipeline

Goals feed into the *existing* Phase 3.1/3.2 pipeline, not a separate one:

```
GoalsRepository.listActive(userId)
        │
        ▼
DailyAssistantContext.goals   (Phase 3.1 — bounded id/title/description)
        │
        ▼
buildDailyContextPrioritizationInput's `goals` param   (Phase 3.2)
        │
        ▼
PrioritizationInput.goals   (omitted entirely when there are none)
        │
        ▼
Groq prioritization prompt — "goals" section (v2 prompt)
```

`GET /api/v1/context/daily` also returns `goals` directly, so the daily
context endpoint and the AI see the exact same active-goals list.

## What the AI may and may not do with goals

The prompt (`apps/api/src/providers/groq/prioritization-prompt.ts`)
instructs the model that a situation plausibly relating to a stated goal may
be worth surfacing more than one that doesn't — but it is explicitly told
never to claim or imply progress toward a goal that isn't stated in the
input, and goals are not eligible `situationId` targets (the JSON Schema's
`situationId` enum is still built only from the supplied `situations[]` —
a goal can never be returned as if it were a prioritizable situation).

No code anywhere infers, computes, or stores goal progress. That is
entirely out of scope for this phase, by design.

## Code

| Concern | File |
|---|---|
| Prisma model | `apps/api/prisma/schema.prisma` (`Goal`) |
| Repository | `apps/api/src/db/repositories/goals.repository.ts` |
| Validation/service | `apps/api/src/domain/goals.service.ts` |
| HTTP routes | `apps/api/src/routes/goals.ts` |
| Shared contract | `packages/shared/src/contracts/api.schema.ts` (`goalDtoSchema`, `createGoalRequestSchema`, `updateGoalRequestSchema`, `goalsResponseSchema`) |
| Daily-context wiring | `apps/api/src/domain/daily-context.service.ts`, `daily-context/daily-context.builder.ts` |
| Prioritization wiring | `apps/api/src/domain/situation-prioritization.service.ts`, `prioritization/prioritization-input.builder.ts` |
