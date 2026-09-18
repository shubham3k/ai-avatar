# Calendar Upcoming-Meeting Signals (Phase 2.5)

Deterministic detection only — **not AI**. No LLM, no embeddings, no model
call. Same input always produces the same output. Mirrors the approach used
for Gmail signals (`docs/GMAIL_SIGNALS.md`) — read that first if unfamiliar
with the pattern.

## Flow

```
stored CalendarEvent rows (Phase 2.4B)
        ↓
detectUpcomingMeeting() — pure, time-based, deterministic
        ↓
actionable? → Signal (type: user_action_required, source: calendar_event → CalendarEvent.id)
        ↓
Intervention (existing pipeline — same one Gmail signals and the Phase 1 demo use)
        ↓
desktop overlay (existing polling, unchanged)
```

Detection is manually triggered — no cron/background job. Sync and
detection are separate operations, same as Gmail:

```bash
curl -X POST "http://localhost:4000/api/v1/integrations/google/calendar/sync"
curl -X POST "http://localhost:4000/api/v1/integrations/google/calendar/detect-signals"
```

## Endpoint

`POST /api/v1/integrations/google/calendar/detect-signals?limit=10` (max 25)

1. Loads the user's soonest-first upcoming events
   (`calendar-events.repository.listUpcoming`, already filtered to
   `startAt >= now` — nothing further back needs the detector at all).
2. Runs the deterministic detector against each one.
3. For actionable events, finds-or-creates a `Signal`, then finds-or-creates
   an `Intervention` for that signal — through the **existing**
   `SignalsRepository`/`InterventionsRepository`, the same ones Gmail
   signals and the Phase 1 demo pipeline use. No new signal/intervention
   system.
4. Returns a summary only:
   ```json
   { "analyzed": 10, "actionable": 2, "signalsCreated": 2, "interventionsCreated": 2 }
   ```

## Rule: upcoming meeting

A single rule, purely time-based — no title/attendee/organizer-based
"importance" heuristics, because calendar metadata alone can't reliably
signal that.

**Gates (all must pass):**
- not an all-day event
- `status !== "cancelled"`
- has a valid, parseable `startAt`
- `startAt` has not already passed
- `startAt` is within **30 minutes** from now (`ACTIONABLE_WINDOW_MINUTES`)

**Priority (both thresholds are named constants in
`upcoming-meeting.rules.ts`, not scattered magic numbers):**
- `minutesUntilStart <= 10` (`HIGH_PRIORITY_WINDOW_MINUTES`) → `high`
- `10 < minutesUntilStart <= 30` → `medium`

Both threshold checks are inclusive at their boundary (exactly 30 minutes
out is still actionable; exactly 10 minutes out is still high priority).

**Attendees/organizer are never part of the decision.** They're accepted by
the detector's input type and passed through into the signal's
`importanceHints`-equivalent context for future use, but "has attendees" or
"attendee count" does not make an otherwise out-of-window event actionable,
and does not change priority. This is intentional — see AGENTS.md's scope
discipline and the phase brief's explicit warning against inventing
importance from metadata.

## All-day events

Explicitly excluded. The product has no defined interpretation yet for "an
all-day event is starting soon" (an all-day event's `startAt` is anchored to
UTC midnight by the sync layer — see `docs/GOOGLE_CALENDAR.md` — so treating
it like a timed meeting would produce nonsensical countdowns). Revisit only
if a real product requirement emerges.

## Intervention message

Built from the event title with a concrete countdown, never generic:
- `"Client meeting starts in 8 minutes."`
- `"Meeting with Acme starts in 25 minutes."`
- Fallback when the title is missing/blank: `"Upcoming meeting starts in 20 minutes."`

The event `description` is **never** included in the message or exposed by
the detection endpoint — only the title and computed countdown.

## Idempotency

No new dedup mechanism — reuses the same constraints Gmail signals rely on:
`Signal.@@unique([userId, type, sourceType, sourceId])` and
`Intervention.@@unique([signalId])`, both already existing on the schema.
Running `/detect-signals` repeatedly against unchanged upcoming events is a
no-op after the first run.

## Current limitations (intentional)

- Time-based only — no reasoning about meeting importance, title content,
  organizer, or attendee count/response status.
- No cross-source reasoning: Gmail signals and Calendar signals are entirely
  independent in this phase (Phase 2.6+ territory).
- A meeting's actionable window is fixed and small (≤30 min) — there is no
  "prep reminder" concept (e.g. 1 hour before) yet.
- No re-evaluation: once a signal exists for an event, it isn't re-scored as
  the countdown changes (e.g. it won't be silently upgraded from medium to
  high priority as the meeting gets closer — a fresh event/signal identity
  would be needed for that, which this phase intentionally doesn't build).
- No automatic/background detection trigger.

## Code

| Concern | File |
|---|---|
| Thresholds | `apps/api/src/domain/signals/calendar/upcoming-meeting.rules.ts` |
| Detector (pure function) | `apps/api/src/domain/signals/calendar/upcoming-meeting.detector.ts` |
| Types | `apps/api/src/domain/signals/calendar/upcoming-meeting.types.ts` |
| Orchestration (CalendarEvent → Signal → Intervention) | `apps/api/src/domain/calendar-signal-detection.service.ts` |
| HTTP route | `apps/api/src/routes/google-calendar.ts` (`POST /detect-signals`) |
| Shared contract | `packages/shared/src/contracts/api.schema.ts` (`calendarSignalDetectionResponseSchema`) |
