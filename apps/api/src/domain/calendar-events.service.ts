import {
  createGoogleConnectionService,
  type GoogleConnectionService,
} from "./google-connection.service.js";
import {
  createCalendarService,
  type CalendarService,
} from "../providers/google/calendar/calendar.service.js";
import {
  CALENDAR_DEFAULT_EVENT_LIMIT,
  CALENDAR_MAX_EVENT_LIMIT,
  type NormalizedCalendarEvent,
} from "../providers/google/calendar/calendar.types.js";

export function clampCalendarLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return CALENDAR_DEFAULT_EVENT_LIMIT;
  }
  return Math.max(1, Math.min(Math.trunc(requested), CALENDAR_MAX_EVENT_LIMIT));
}

export function createCalendarEventsService(dependencies?: {
  connection?: GoogleConnectionService;
  calendar?: CalendarService;
}) {
  const connection = dependencies?.connection ?? createGoogleConnectionService();
  const calendar = dependencies?.calendar ?? createCalendarService();

  return {
    async listUpcomingEvents(
      userId: string,
      requestedLimit?: number,
      now: Date = new Date(),
    ): Promise<NormalizedCalendarEvent[]> {
      const refreshToken = await connection.getDecryptedRefreshToken(userId);
      const limit = clampCalendarLimit(requestedLimit);
      return calendar.listUpcomingEvents(refreshToken, limit, now);
    },
  };
}

export type CalendarEventsService = ReturnType<typeof createCalendarEventsService>;
