import { atLocalClock, localDateKey, startOfLocalDay } from "./local-time.js";

/** A promise with a date but no time ("by Friday") is taken to be due at the end of the working day. */
export const DEFAULT_PROMISE_DUE_TIME = "17:00";

export interface PromiseTimingInput {
  /** Local date the promise is due, "YYYY-MM-DD" (resolved by the model from the email). */
  dueDate: string;
  /** "HH:MM" when the email named a time, else null. */
  dueTime: string | null;
  now: Date;
  /** Settings: remind the day before at this time (default "10:00"). */
  remindTime: string;
  /** Settings: when it's due today, remind this many hours before (default 2). */
  sameDayLeadHours: number;
}

/**
 * ADR-006 §6: when to remind the user about a promise they made in email —
 * the day before at 10:00, or 2 hours before if it's due today (both
 * configurable). Code computes the time; the model only extracts the date.
 * Returns null for promises already past due or with malformed dates.
 */
export function computePromiseReminder(input: PromiseTimingInput): { dueAt: Date; remindAt: Date } | null {
  const dueAt = atLocalClock(input.dueDate, input.dueTime ?? DEFAULT_PROMISE_DUE_TIME);
  if (!dueAt || dueAt.getTime() <= input.now.getTime()) return null;

  const sameDayLead = new Date(dueAt.getTime() - input.sameDayLeadHours * 60 * 60_000);
  const nowOrLater = (date: Date) => (date.getTime() > input.now.getTime() ? date : input.now);

  if (input.dueDate === localDateKey(input.now)) {
    return { dueAt, remindAt: nowOrLater(sameDayLead) };
  }
  const dayBefore = atLocalClock(localDateKey(startOfLocalDay(dueAt, -1)), input.remindTime);
  if (dayBefore && dayBefore.getTime() > input.now.getTime()) return { dueAt, remindAt: dayBefore };
  // Too late for "the day before" (e.g. due tomorrow, noticed this evening).
  return { dueAt, remindAt: nowOrLater(sameDayLead) };
}
