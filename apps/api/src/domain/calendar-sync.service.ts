import {
  createCalendarEventsRepository,
  type CalendarEventsRepository,
  type UpsertCalendarEventInput,
} from "../db/repositories/calendar-events.repository.js";
import { clampCalendarLimit } from "./calendar-events.service.js";
import {
  createGoogleConnectionService,
  type GoogleConnectionService,
} from "./google-connection.service.js";
import { prisma } from "../lib/prisma.js";
import {
  createCalendarService,
  type CalendarService,
} from "../providers/google/calendar/calendar.service.js";
import type { NormalizedCalendarEvent } from "../providers/google/calendar/calendar.types.js";

export interface CalendarSyncResult {
  fetched: number;
  created: number;
  updated: number;
}

const NO_TITLE = "(no title)";

/**
 * Google represents an all-day event's start/end as a plain "YYYY-MM-DD"
 * date and a timed event's as a full ISO datetime. `CalendarEvent.startAt`/
 * `endAt` are non-nullable `DateTime` columns, so a date-only value is
 * anchored to UTC midnight; `isAllDay` tells callers to ignore the
 * time-of-day. Returns null for a missing/unparsable value so the caller can
 * skip that event rather than persist a bogus date.
 */
function parseEventDate(value: string | null): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toCalendarEventInput(
  userId: string,
  event: NormalizedCalendarEvent,
  now: Date,
): UpsertCalendarEventInput | null {
  const startAt = parseEventDate(event.start);
  const endAt = parseEventDate(event.end);
  if (!startAt || !endAt) return null;

  return {
    userId,
    providerEventId: event.id,
    calendarId: event.calendarId,
    title: event.summary && event.summary.trim().length > 0 ? event.summary : NO_TITLE,
    description: event.description,
    location: event.location,
    startAt,
    endAt,
    isAllDay: event.isAllDay,
    status: event.status,
    organizerEmail: event.organizer?.email ?? null,
    organizerName: event.organizer?.displayName ?? null,
    attendeeEmails: event.attendees
      .map((attendee) => attendee.email)
      .filter((email): email is string => Boolean(email)),
    attendees: event.attendees,
    sourceUrl: event.htmlLink,
    rawUpdatedAt: now,
  };
}

export function createCalendarSyncService(dependencies?: {
  connection?: GoogleConnectionService;
  calendar?: CalendarService;
  events?: CalendarEventsRepository;
}) {
  const connection = dependencies?.connection ?? createGoogleConnectionService();
  const calendar = dependencies?.calendar ?? createCalendarService();
  const events = dependencies?.events ?? createCalendarEventsRepository(prisma);

  return {
    async sync(
      userId: string,
      requestedLimit?: number,
      now: Date = new Date(),
    ): Promise<CalendarSyncResult> {
      const refreshToken = await connection.getDecryptedRefreshToken(userId);
      const limit = clampCalendarLimit(requestedLimit);
      const calendarEvents = await calendar.listUpcomingEvents(refreshToken, limit, now);

      const inputs = calendarEvents
        .map((event) => toCalendarEventInput(userId, event, now))
        .filter((input): input is UpsertCalendarEventInput => input !== null);
      const tally = await events.upsertMany(inputs);

      return { fetched: calendarEvents.length, ...tally };
    },
  };
}

export type CalendarSyncService = ReturnType<typeof createCalendarSyncService>;
