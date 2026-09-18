# Daily Context (Phase 3.1)

A bounded, read-only snapshot of the user's current operating state, built
entirely from existing Phase 2 data — no new Gmail/Calendar logic, no new
external calls.

## Endpoint

`GET /api/v1/context/daily` — read-only. Never creates a `Signal` or
`Intervention`.

```json
{
  "currentTime": "2026-09-16T12:00:00.000Z",
  "upcomingEvents": [
    { "id": "...", "summary": "...", "startAt": "...", "endAt": "...", "attendeeEmails": [] }
  ],
  "relevantEmails": [
    { "id": "...", "fromEmail": "...", "subject": "...", "snippet": "...", "receivedAt": "..." }
  ],
  "activeSignals": [
    { "id": "...", "sourceType": "email", "title": "...", "confidence": "high", "dueAt": null }
  ],
  "consolidatedSituations": [ /* same shape as GET /context/situations */ ],
  "goals": [
    { "id": "...", "title": "Launch my product", "description": "v1 by Q4" }
  ]
}
```

`goals` was added in Phase 3.4 — see [docs/GOALS.md](./GOALS.md). It's the
user's currently *active* goals only (`GoalsRepository.listActive`);
deactivated goals never appear here.

## What it reuses (unmodified)

| Field | Source |
|---|---|
| `upcomingEvents` | `CalendarEventsRepository.listUpcoming` (Phase 2.4B), filtered to the next 24h |
| `relevantEmails` | `EmailsRepository.listRecent` (Phase 2.2B), filtered to the previous 24h |
| `activeSignals` | `SignalsRepository.listOpen` (Phase 2.6B) — already-open signals only |
| `consolidatedSituations` | `ConsolidatedSituationsService.getSituations` (Phase 2.6B), unchanged |

Neither `listUpcoming` nor `listRecent` is itself date-windowed (they return
"most upcoming N" / "most recent N"). The 24h windows are applied as a pure
in-memory filter on top of their existing output — see
`buildDailyContext` — rather than adding new query parameters to those
repositories, so Phase 2's own tests and callers are untouched.

## Bounded fields — what's deliberately excluded

Same trust boundary as Phase 2.7's prioritization input: no email body, no
calendar description, no OAuth/refresh/access tokens, no encryption key, no
unrelated database fields. `relevantEmails`/`upcomingEvents` carry the exact
same whitelisted shape already used by `PrioritizationEmailContext`/
`PrioritizationCalendarContext`.

## Code

| Concern | File |
|---|---|
| Types | `apps/api/src/domain/daily-context/daily-context.types.ts` |
| Window constants | `apps/api/src/domain/daily-context/daily-context.rules.ts` |
| Pure builder (windowing + mapping, no I/O) | `apps/api/src/domain/daily-context/daily-context.builder.ts` |
| Orchestration (loads data via existing repos/services) | `apps/api/src/domain/daily-context.service.ts` |
| HTTP route | `apps/api/src/routes/context.ts` (`GET /daily`) |
| Shared contract | `packages/shared/src/contracts/api.schema.ts` (`dailyContextResponseSchema`) |
