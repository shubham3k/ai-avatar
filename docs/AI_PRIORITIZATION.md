# AI Prioritization (Phase 2.7)

**Advisory only.** The model ranks and explains *existing* consolidated
situations (Phase 2.6B) — it does not detect new situations, does not read
Gmail/Calendar, does not call Google APIs, and cannot create a `Signal`, an
`Intervention`, or take any external action. All of that stays the
deterministic system's job, unchanged.

## Purpose

Answer "what actually matters right now?" across the situations the
deterministic pipeline already produced, so a future phase can turn that
into fewer, better interventions instead of one per raw signal.

## Flow

```
open Signal rows (Phase 2.3 + 2.5, unchanged)
                │
                ▼
   ConsolidatedSituation[] (Phase 2.6B, unchanged, reused as-is)
                │
                ▼
   buildPrioritizationInput() — pure, bounded, whitelisted fields
                │
                ▼
        Groq Chat Completions API (structured output, strict JSON schema)
                │
                ▼
   validated PrioritizedSituationResult[]  (in-memory only)
```

## Endpoint

`GET /api/v1/prioritization` — read-only.

```json
{
  "prioritizedSituations": [
    {
      "situationId": "signal_abc:signal_def",
      "priority": "high",
      "reason": "The meeting starts in 25 minutes and the email is asking for feedback beforehand.",
      "recommendedAction": "Reply with feedback before the meeting."
    }
  ]
}
```

If there are no consolidated situations, the response is
`{"prioritizedSituations": []}` and **Groq is never called** — no
API cost, no latency, for the (common) case where nothing needs surfacing.

## Input sent to the model

For each situation, only:

| Field | Source | Notes |
|---|---|---|
| `relationship.type` / `.strength` | Phase 2.6A | as-is |
| `email.fromEmail`, `.subject`, `.snippet`, `.receivedAt` | stored `Email` | **no body** — never fetched by Gmail sync in the first place |
| `calendarEvent.summary`, `.startAt`, `.endAt`, `.attendeeEmails` | stored `CalendarEvent` | **`description` is deliberately excluded** |
| `signals[].sourceType`, `.confidence`, `.dueAt` | stored `Signal` | `confidence` is the existing `importanceHints.confidence` Phase 2.3/2.5 already wrote |

Never sent: OAuth tokens, refresh tokens, the encryption key, any credential,
unrelated database fields, or any field not in the table above. See
`apps/api/src/domain/prioritization/prioritization-input.builder.ts` — a
pure function, independently unit-tested to confirm the excluded fields
never appear in its output.

## Output schema

Zod contract: `packages/shared/src/contracts/api.schema.ts` →
`prioritizationResponseSchema` (`priority` is a fixed 3-value enum:
`"high" | "medium" | "low"`).

The **same request's** known `situationId`s are compiled into the JSON
Schema sent to Groq's Structured Outputs feature as a literal `enum` — the
model is structurally prevented from inventing an ID, not just asked not to.
`priority` is similarly constrained to the 3-value enum at generation time.

As defense in depth (a provider technically returning something outside the
schema, or a mocked/misbehaving provider in tests), the API layer
independently re-validates every entry: any item referencing an unknown
`situationId` or an out-of-enum `priority` is **silently dropped**, not
propagated and not treated as a hard failure — one bad entry doesn't
invalidate an otherwise-good batch.

## Prompt

Versioned: `apps/api/src/providers/openai/prioritization-prompt.ts`,
`PRIORITIZATION_PROMPT_VERSION = "v1"`. Instructs the model to reason only
from supplied fields, never invent IDs/people/deadlines, weigh urgency
(meeting proximity, whether an email needs a reply) and relationship
strength (`attendee_match` > `topic_overlap`), avoid marking everything
"high", and phrase `recommendedAction` as a suggestion, not something it
already did.

## Model / configuration

**As of the Phase 2 manual-validation pass, this uses Groq instead of
OpenAI** (the user did not have OpenAI API access). Groq exposes an
OpenAI-SDK-compatible Chat Completions endpoint with the same strict
JSON-schema structured-output feature this service already relied on, so
the swap only touched the provider adapter — no domain/routing logic
changed.

- `GROQ_API_KEY` (required to actually call the model — see Failure
  behavior below) and `GROQ_MODEL` (optional, defaults to
  `qwen/qwen3.8-27b`; was `qwen/qwen3-32b` until Groq retired it in Sept 2026) — both env vars, read via the existing `env.ts` schema.
  No key/model is ever hard-coded.
- Uses the `openai` npm package pointed at Groq's OpenAI-compatible base
  URL (`https://api.groq.com/openai/v1`), calling
  `client.chat.completions.create()` with
  `response_format: { type: "json_schema", json_schema: { strict: true, ... } }`
  — Groq doesn't have an OpenAI-style Responses API, only Chat Completions.
  Strict structured-output mode currently only works on a handful of Groq
  models (e.g. `qwen/qwen3-32b`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`);
  picking a different `GROQ_MODEL` without strict-mode support will likely
  fail schema validation.
- Isolated in `apps/api/src/providers/groq/groq-client.ts` — the only
  file in the codebase that imports the `openai` package.

## Failure behavior

AI failure never touches the deterministic system — no `Signal`/
`Intervention` is created or modified in any case below, and nothing is
fabricated as a fallback.

| Situation | Result |
|---|---|
| No `GROQ_API_KEY` configured | `400 validation_error` — clear message, no Groq call attempted |
| Groq timeout / rate limit / 5xx / auth rejection | `502 upstream_error` — generic safe message, raw provider error never surfaced |
| Model returns non-JSON or the wrong shape | `502 upstream_error` |
| Model includes an unknown `situationId` or invalid `priority` on some entries | that entry is dropped; other valid entries are still returned normally (`200`) |
| No consolidated situations exist | `200` with `{"prioritizedSituations": []}`, no Groq call |

## Privacy

Never logged, never sent, never returned: OAuth/refresh/access tokens, the
encryption key, email body, calendar description. The endpoint's own
response contains no PII beyond what the model was given (sender email,
subject, snippet, event summary/time/attendees) — the same data the
deterministic signals were already built from.

## Phase 3.2 — daily-context-aware input

`GET /api/v1/prioritization` (and `POST /api/v1/assistant/evaluate`, which
reuses the same `situation-prioritization.service.ts`) now sends a richer
input: alongside the unchanged per-situation `situations[]` array, the model
also receives `currentTime`, `upcomingEvents` (next 24h), and `relevantEmails`
(last 24h) — the same bounded fields as [Phase 3.1's daily
context](./DAILY_CONTEXT.md), built via the exact same pure
`buildDailyContext` function on data the service already loaded (no new DB
calls). `goals` (Phase 3.4) is included once any exist, omitted otherwise.

This is additive context only: the JSON Schema constraining the model's
output is unchanged (`situationId` is still a literal enum of only the known
`situations[]` IDs — the model cannot return a priority entry for anything
in `upcomingEvents`/`relevantEmails`/`goals`, by construction, not just by
prompt instruction). Prompt bumped to `v2` to describe the new fields.

## Explicit limitations

- **Advisory only** — nothing in this phase acts on the model's output. A
  future phase decides whether/how a `priority`/`reason`/`recommendedAction`
  becomes an actual intervention.
- Single bounded, non-streaming Groq call per request — no agents, no tool
  calling, no multi-step reasoning, no memory across requests.
- No caching — every request re-evaluates from scratch (situations are
  cheap to recompute; see `docs/CONSOLIDATED_SITUATIONS.md`).
- Entries the model chooses to omit (situations it judged not worth
  surfacing) simply don't appear in `prioritizedSituations` — that's
  expected, not an error.

## Code

| Concern | File |
|---|---|
| Groq client wrapper | `apps/api/src/providers/groq/groq-client.ts` |
| Prompt (versioned) | `apps/api/src/providers/groq/prioritization-prompt.ts` |
| Structured-output JSON Schema builder | `apps/api/src/providers/groq/prioritization-schema.ts` |
| Bounded input types + pure builder | `apps/api/src/domain/prioritization/prioritization.types.ts`, `prioritization-input.builder.ts` |
| Core AI-calling service (testable without a live call) | `apps/api/src/domain/prioritization/prioritization.service.ts` |
| Orchestration (loads data, wires everything) | `apps/api/src/domain/situation-prioritization.service.ts` |
| HTTP route | `apps/api/src/routes/prioritization.ts` |
| Shared contract | `packages/shared/src/contracts/api.schema.ts` (`prioritizationResponseSchema`) |
