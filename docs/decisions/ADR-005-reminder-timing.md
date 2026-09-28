# ADR-005: LLM Extracts Reminder Intent, Code Computes Times; 1-Minute Local Delivery Tick

## Context

Hands-on testing of the packaged app (September 25, 2026) found that
natural-language reminders were unreliable in three ways:

1. **Timezone.** The parser asked Groq to return a finished ISO timestamp,
   but sent it `now` in UTC. "Remind me at 3:40 pm" came back as 15:40 UTC —
   9:10 PM for a user in IST.
2. **Lead time.** Groq also decided how far ahead to alert. "Remind me in 10
   minutes" came back as event = now+10, lead = 10, so the alert fired
   immediately. Results varied between similar phrases.
3. **Delivery.** Due reminders were only checked inside the 15-minute
   Gmail/Calendar sync (and only when Google was connected), so a reminder
   could fire up to ~15 minutes late. Calendar meetings alerted anywhere
   inside a 30-minute window, not at a predictable time.

The user's stated rules:

| Input | Alert at |
| --- | --- |
| "Remind me at 4 pm to …" | 4:00 exactly |
| "Remind me in 10 minutes …" | now + 10 exactly |
| "There's a meeting at 5 pm" | 4:50 (10 min before) |
| A Google Calendar event at 4 pm | 3:50 (10 min before) |

## Decision

1. **The LLM extracts intent only; code computes all times.** Groq returns
   `{reminderText, kind: "ping" | "event", timeType: "relative" | "clock" |
   "none", relativeMinutes, date, time, leadMinutes}` — words-to-structure,
   no arithmetic. A pure function (`reminder-timing.ts`) turns that into
   `dueAt`/`remindAt` using the machine's local timezone (the API runs
   in-process inside the desktop app on the user's own PC, so local time
   *is* the user's time). `ping` fires at the stated time; `event` fires
   `leadMinutes` early (default 10). An alert is never scheduled in the past.
   Output is still Zod-validated before any state change.
2. **A local delivery tick** (every 15s — was 1 minute until Sept 28, see
   below) in the desktop scheduler runs only
   `reminders/detect-signals` and `calendar/detect-signals` — both read the
   local SQLite database only (no Google, no Groq calls, no cost). The full
   sync (Gmail/Calendar fetch + AI evaluation) is separate — its default
   interval was also lowered from 15 to 5 minutes the same day, so new email
   and newly added calendar events are picked up sooner. Both
   cadences share one in-flight guard so they never overlap. Reminder
   delivery no longer requires Google to be connected. "Pause notifications"
   still silences both.
3. **Calendar alert window: 10 minutes** before start (was 30).

## Consequences

- Reminder times are deterministic and unit-testable; the LLM can no longer
  get the timezone or lead-time arithmetic wrong.
- Reminders and meetings alert within ~15 seconds of their target time.
- **Sept 28 follow-up:** with a 60s tick plus the renderer's 15s inbox poll,
  an alert could land ~75s late (observed: due 13:03:34, next tick 13:04:16).
  Now the tick is 15s and the scheduler pushes `inbox:changed` to the
  renderer after every completed check (`onTickComplete`), so the popup
  appears as soon as the intervention exists; the 15s poll is only a fallback.
- A calendar event created less than ~5 minutes before it starts may be
  missed until the next full sync fetches it (the tick only sees
  already-synced events). User-created reminders have no such gap.
- Alternative rejected: keep the LLM computing timestamps and just send it
  a local-offset `now`. Fixes the timezone bug only; lead-time arithmetic
  would stay model-dependent.
