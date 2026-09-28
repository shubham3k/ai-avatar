/**
 * Deterministic time math for natural-language reminders (see
 * docs/decisions/ADR-005-reminder-timing.md). The LLM only extracts
 * *intent* — what kind of time was said and whether it's a direct "ping me"
 * request or an event to be warned about — and this module computes the
 * actual instants. Pure: no I/O, same input always gives the same output.
 *
 * "Local time" is the machine's own timezone: the API runs in-process inside
 * the desktop app on the user's PC, so that *is* the user's timezone.
 */

/** "Remind me at 4pm" / "in 10 minutes" → fire exactly then. "Meeting at 5pm" → fire a little before. */
export type ReminderKind = "ping" | "event";

export type ReminderTimeType = "relative" | "clock" | "none";

export interface ReminderIntent {
  kind: ReminderKind;
  timeType: ReminderTimeType;
  /** For timeType "relative": minutes from now. */
  relativeMinutes: number | null;
  /** For timeType "clock": local date "YYYY-MM-DD", or null for "the next occurrence of `time`". */
  date: string | null;
  /** For timeType "clock": local 24h time "HH:MM", or null (defaults to 09:00 when a date was given). */
  time: string | null;
  /** Only when the user explicitly asked for advance notice ("remind me 15 minutes before"). */
  leadMinutes: number | null;
}

export type ReminderTimingFailureCode = "missing_time" | "invalid_time" | "time_in_past";

export type ReminderTimingOutcome =
  | { ok: true; dueAt: Date; remindAt: Date }
  | { ok: false; code: ReminderTimingFailureCode };

/** Heads-up given before an "event" when the user didn't ask for a specific lead time. */
export const DEFAULT_EVENT_LEAD_MINUTES = 10;
export const MAX_LEAD_MINUTES = 1440;
/** One year — anything further out is almost certainly a misparse. */
export const MAX_RELATIVE_MINUTES = 366 * 24 * 60;
const DEFAULT_CLOCK_TIME = "09:00";
/** Tolerates request latency for "right now"-ish explicit dates, same idea as reminders.service.ts's picker grace window. */
const PAST_GRACE_MS = 60_000;
const MINUTE_MS = 60_000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = TIME_PATTERN.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/** Builds a local-time Date, rejecting impossible dates (e.g. 2026-02-30) that the Date constructor would silently roll over. */
function localDate(dateText: string, hours: number, minutes: number): Date | null {
  const match = DATE_PATTERN.exec(dateText.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
    return null;
  }
  return result;
}

function pad2(value: number): string {
  return String(Math.trunc(Math.abs(value))).padStart(2, "0");
}

/** "YYYY-MM-DD" of `date` in local time. */
function localDateText(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function resolveDueAt(
  intent: ReminderIntent,
  now: Date,
): { ok: true; dueAt: Date } | { ok: false; code: ReminderTimingFailureCode } {
  if (intent.timeType === "relative") {
    const minutes = intent.relativeMinutes;
    if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
      return { ok: false, code: "invalid_time" };
    }
    if (minutes > MAX_RELATIVE_MINUTES) return { ok: false, code: "invalid_time" };
    return { ok: true, dueAt: new Date(now.getTime() + Math.round(minutes) * MINUTE_MS) };
  }

  if (intent.timeType === "clock") {
    if (intent.date === null && intent.time === null) return { ok: false, code: "missing_time" };
    const clock = parseTime(intent.time ?? DEFAULT_CLOCK_TIME);
    if (!clock) return { ok: false, code: "invalid_time" };

    // The model occasionally fills in today's date for a bare time ("at
    // 3:40pm") despite the prompt — treat that like no date, so a passed
    // time rolls to tomorrow instead of being rejected.
    if (intent.date !== null && intent.date.trim() !== localDateText(now)) {
      const dueAt = localDate(intent.date, clock.hours, clock.minutes);
      if (!dueAt) return { ok: false, code: "invalid_time" };
      if (dueAt.getTime() < now.getTime() - PAST_GRACE_MS) {
        return { ok: false, code: "time_in_past" };
      }
      return { ok: true, dueAt };
    }

    // Bare time: today, or tomorrow if that time has already passed today.
    const dueAt = new Date(now);
    dueAt.setHours(clock.hours, clock.minutes, 0, 0);
    if (dueAt.getTime() <= now.getTime()) {
      // setDate (not +24h) so a DST change overnight still lands on the same wall-clock time.
      dueAt.setDate(dueAt.getDate() + 1);
    }
    return { ok: true, dueAt };
  }

  return { ok: false, code: "missing_time" };
}

export function resolveReminderTiming(
  intent: ReminderIntent,
  now: Date = new Date(),
): ReminderTimingOutcome {
  const resolved = resolveDueAt(intent, now);
  if (!resolved.ok) return resolved;
  const { dueAt } = resolved;

  const requestedLead =
    intent.leadMinutes ?? (intent.kind === "event" ? DEFAULT_EVENT_LEAD_MINUTES : 0);
  const leadMinutes = Number.isFinite(requestedLead)
    ? Math.max(0, Math.min(MAX_LEAD_MINUTES, Math.round(requestedLead)))
    : 0;

  // Never schedule the alert in the past: an event sooner than its lead time
  // ("meeting in 5 minutes") alerts right away rather than being lost.
  const remindAtCandidate = dueAt.getTime() - leadMinutes * MINUTE_MS;
  const remindAt = new Date(Math.max(remindAtCandidate, now.getTime()));

  return { ok: true, dueAt, remindAt };
}

/** Local ISO-8601 with offset and weekday, e.g. "2026-09-25T15:40:00+05:30 (Friday)" — what the LLM needs to resolve "tomorrow"/"Monday" against. */
export function formatLocalNow(now: Date): string {
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offset = `${sign}${pad2(offsetMinutes / 60)}:${pad2(offsetMinutes % 60)}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return (
    `${localDateText(now)}` +
    `T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}${offset}` +
    ` (${weekday})`
  );
}
