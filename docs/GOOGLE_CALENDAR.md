# Google Calendar (Phase 2.4A read access + Phase 2.4B persistence/sync)

No signal detection, no AI, no writes. Mirrors the Gmail pattern
(`docs/GOOGLE_OAUTH.md` section 4a, `docs/PHASE_PLAN.md` Phase 2.2B).

## 1. Read access (Phase 2.4A)

`GET /api/v1/integrations/google/calendar/events?limit=10` (max 25)

Uses the existing Google connection (Phase 2.1) — no separate OAuth flow, and
reuses the `calendar.readonly` scope already requested during `/connect`.

Queries the user's **primary** calendar with `timeMin=now`, `singleEvents=true`,
`orderBy=startTime` — i.e. only upcoming events, individual instances (not
recurrence masters), soonest first. Cancelled events are excluded.

**Try it locally** (after connecting Google):
```bash
curl "http://localhost:4000/api/v1/integrations/google/calendar/events?limit=5"
```

## Normalized event

```json
{
  "events": [
    {
      "id": "...", "calendarId": "primary",
      "summary": "...", "description": "...", "location": "...",
      "start": "2026-09-15T10:00:00-07:00", "end": "2026-09-15T11:00:00-07:00",
      "isAllDay": false,
      "attendees": [{ "email": "...", "displayName": "...", "responseStatus": "..." }],
      "organizer": { "email": "...", "displayName": "..." },
      "status": "confirmed", "htmlLink": "..."
    }
  ]
}
```

For an all-day event, `start`/`end` are Google's plain `"YYYY-MM-DD"` date
strings (not a full datetime) and `isAllDay` is `true`. Missing fields come
back as `null`/`[]` rather than throwing.

Errors: `404 not_found` (no Google connection), `400 validation_error`
(`limit` outside 1-25), `403 forbidden` (invalid/revoked authorization), `502
upstream_error` (Calendar API unavailable/rate-limited).

## 2. Persistence & sync (Phase 2.4B)

`POST /api/v1/integrations/google/calendar/sync?limit=10` (max 25) fetches
upcoming events (same call as section 1) and upserts them into the
`CalendarEvent` table, keyed on `(userId, calendarId, providerEventId)` —
this composite unique constraint already existed on the model from Phase 1,
so no new dedup mechanism was built.

- **Idempotent**: re-running sync with unchanged Calendar data updates the
  existing rows in place, never inserts duplicates.
- **Updates in place**: if an event's `status` (e.g. `confirmed` →
  `tentative`) or attendee responses change, the stored row is updated.
- **Timed vs all-day**: a timed event's `start`/`end` persist as their exact
  instant; an all-day event's date-only `"YYYY-MM-DD"` is anchored to UTC
  midnight, with `isAllDay: true` telling readers to ignore the time-of-day.
- **Skips, doesn't crash, on unpersistable events**: `CalendarEvent.startAt`/
  `endAt` are non-nullable columns — an event with a missing/unparsable
  start or end is skipped (not persisted, not an error) rather than crashing
  the whole sync. `fetched` in the response still counts it; `created` +
  `updated` won't.
- Response is a summary only, never event contents:
  ```json
  { "fetched": 10, "created": 7, "updated": 3 }
  ```

`GET /api/v1/integrations/google/calendar/stored-events?limit=10` (max 50) —
minimal read of what's already persisted (only future events, ordered
soonest-first), for local testing/inspection; does not call the Calendar API.

**Try it locally:**
```bash
curl -X POST "http://localhost:4000/api/v1/integrations/google/calendar/sync?limit=10"
curl "http://localhost:4000/api/v1/integrations/google/calendar/stored-events"
```

## 3. What's stored

Extends the `CalendarEvent` model that already existed from Phase 1
(`title`, `description`, `startAt`, `endAt`, `organizerEmail`,
`attendeeEmails`, `sourceUrl`) with the fields needed to preserve what
Phase 2.4A's normalization produces: `location`, `isAllDay`, `status`,
`organizerName`, and `attendees` (a `Json` array of `{email, displayName,
responseStatus}` — kept alongside the existing flat `attendeeEmails` list
rather than replacing it, so simple email-based lookups don't need to parse
JSON). No event body/notes beyond `description` are fetched — persistence
does not expand what Phase 2.4A already pulls from the Calendar API.

## 4. Code

| Concern | File |
|---|---|
| Calendar API client wrapper | `apps/api/src/providers/google/calendar/calendar.service.ts` |
| Shared Google API error mapping | `apps/api/src/providers/google/google-api-error.ts` (also used by Gmail) |
| Connection lookup + decrypt | `apps/api/src/domain/calendar-events.service.ts` (reuses `google-connection.service.ts`) |
| Event persistence | `apps/api/prisma/schema.prisma` (`CalendarEvent`), `apps/api/src/db/repositories/calendar-events.repository.ts` |
| Sync orchestration | `apps/api/src/domain/calendar-sync.service.ts` |
| HTTP routes | `apps/api/src/routes/google-calendar.ts` |
| Shared contracts | `packages/shared/src/contracts/api.schema.ts` (`calendarEventDtoSchema`, `calendarSyncResponseSchema`) |

## 5. Explicitly not implemented

Calendar signal detection, AI, event creation/update/deletion, attendee
responses, reminders, and any background/scheduled job (sync is manually
triggered only) — see `docs/PHASE_PLAN.md` for what's next.
