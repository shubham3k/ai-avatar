import { google, type calendar_v3 } from "googleapis";
import { mapGoogleApiError } from "../google-api-error.js";
import {
  createGoogleOAuthService,
  type GoogleOAuthService,
} from "../oauth/google-oauth.service.js";
import {
  CALENDAR_MAX_EVENT_LIMIT,
  PRIMARY_CALENDAR_ID,
  type NormalizedCalendarAttendee,
  type NormalizedCalendarEvent,
  type NormalizedCalendarOrganizer,
} from "./calendar.types.js";

function mapCalendarError(err: unknown): Error {
  return mapGoogleApiError(err, "Calendar");
}

function normalizeDateTime(
  point: calendar_v3.Schema$EventDateTime | undefined,
): { value: string | null; isAllDay: boolean } {
  if (!point) return { value: null, isAllDay: false };
  if (point.dateTime) return { value: point.dateTime, isAllDay: false };
  if (point.date) return { value: point.date, isAllDay: true };
  return { value: null, isAllDay: false };
}

function normalizeAttendee(
  attendee: calendar_v3.Schema$EventAttendee,
): NormalizedCalendarAttendee {
  return {
    email: attendee.email ?? null,
    displayName: attendee.displayName ?? null,
    responseStatus: attendee.responseStatus ?? null,
  };
}

function normalizeOrganizer(
  organizer: calendar_v3.Schema$Event["organizer"],
): NormalizedCalendarOrganizer | null {
  if (!organizer) return null;
  return {
    email: organizer.email ?? null,
    displayName: organizer.displayName ?? null,
  };
}

function normalizeEvent(
  event: calendar_v3.Schema$Event,
  calendarId: string,
): NormalizedCalendarEvent {
  const start = normalizeDateTime(event.start ?? undefined);
  const end = normalizeDateTime(event.end ?? undefined);
  return {
    id: event.id ?? "",
    calendarId,
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    start: start.value,
    end: end.value,
    isAllDay: start.isAllDay || end.isAllDay,
    attendees: (event.attendees ?? []).map(normalizeAttendee),
    organizer: normalizeOrganizer(event.organizer),
    status: event.status ?? null,
    htmlLink: event.htmlLink ?? null,
  };
}

export interface CalendarService {
  listUpcomingEvents(
    refreshToken: string,
    limit: number,
    now?: Date,
  ): Promise<NormalizedCalendarEvent[]>;
}

export function createCalendarService(dependencies?: {
  oauth?: GoogleOAuthService;
}): CalendarService {
  const oauth = dependencies?.oauth ?? createGoogleOAuthService();

  return {
    async listUpcomingEvents(refreshToken, limit, now = new Date()) {
      const safeLimit = Math.max(1, Math.min(limit, CALENDAR_MAX_EVENT_LIMIT));

      const auth = oauth.createAuthorizedClient(refreshToken);
      const calendar = google.calendar({ version: "v3", auth });

      let items: calendar_v3.Schema$Event[];
      try {
        const res = await calendar.events.list({
          calendarId: PRIMARY_CALENDAR_ID,
          timeMin: now.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: safeLimit,
        });
        items = res.data.items ?? [];
      } catch (err) {
        throw mapCalendarError(err);
      }

      return items
        .filter((event) => event.status !== "cancelled")
        .map((event) => normalizeEvent(event, PRIMARY_CALENDAR_ID));
    },
  };
}
