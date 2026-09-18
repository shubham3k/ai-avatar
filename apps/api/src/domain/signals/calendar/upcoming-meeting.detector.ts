import {
  ACTIONABLE_WINDOW_MINUTES,
  HIGH_PRIORITY_WINDOW_MINUTES,
} from "./upcoming-meeting.rules.js";
import type {
  UpcomingMeetingInput,
  UpcomingMeetingResult,
} from "./upcoming-meeting.types.js";

const MINUTE_MS = 60 * 1000;

function notActionable(reason: string): UpcomingMeetingResult {
  return { actionable: false, confidence: null, reason, minutesUntilStart: null };
}

function meetingLabel(title: string | null): string {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Upcoming meeting";
}

function buildReason(title: string | null, minutesUntilStart: number): string {
  const label = meetingLabel(title);
  const minutes = Math.max(0, Math.round(minutesUntilStart));
  return `${label} starts in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/**
 * Deterministic, time-based check for whether a persisted CalendarEvent is
 * an "upcoming meeting" worth surfacing. Pure function: same input always
 * produces the same output, never throws. Attendees/organizer are accepted
 * for future context but never influence the actionable/priority decision —
 * "has attendees" is not treated as "is important".
 */
export function detectUpcomingMeeting(
  input: UpcomingMeetingInput,
  now: Date = new Date(),
  windowMinutes: number = ACTIONABLE_WINDOW_MINUTES,
  highPriorityMinutes: number = HIGH_PRIORITY_WINDOW_MINUTES,
): UpcomingMeetingResult {
  if (input.isAllDay) {
    return notActionable("All-day events are not evaluated as upcoming meetings.");
  }

  if (input.status === "cancelled") {
    return notActionable("Event is cancelled.");
  }

  const startAt = input.startAt;
  if (!startAt || Number.isNaN(startAt.getTime())) {
    return notActionable("Event has no valid start time.");
  }

  const minutesUntilStart = (startAt.getTime() - now.getTime()) / MINUTE_MS;

  if (minutesUntilStart < 0) {
    return notActionable("Event has already started.");
  }

  if (minutesUntilStart > windowMinutes) {
    return notActionable(
      `Event starts in more than ${windowMinutes} minutes — outside the attention window.`,
    );
  }

  const confidence = minutesUntilStart <= highPriorityMinutes ? "high" : "medium";

  return {
    actionable: true,
    confidence,
    reason: buildReason(input.title, minutesUntilStart),
    minutesUntilStart: Math.max(0, Math.round(minutesUntilStart)),
  };
}
