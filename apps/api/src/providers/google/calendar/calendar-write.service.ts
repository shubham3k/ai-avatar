import { google, type calendar_v3 } from "googleapis";
import { mapGoogleApiError } from "../google-api-error.js";
import { createGoogleOAuthService, type GoogleOAuthService } from "../oauth/google-oauth.service.js";
import { normalizeEvent } from "./calendar.service.js";
import type { NormalizedCalendarEvent } from "./calendar.types.js";

/**
 * ADR-006 M7: changing the user's own primary calendar (calendar.events
 * scope). Only called by the approval layer. Attendees get Google's own
 * invitation/update emails only when there are attendees ("all"), never
 * for events that involve just the user ("none").
 */
export interface CalendarEventFields {
  title: string;
  start: Date;
  end: Date;
  attendees: string[];
  location?: string | null;
  description?: string | null;
}

export interface CalendarWriteService {
  create(refreshToken: string, fields: CalendarEventFields): Promise<NormalizedCalendarEvent>;
  update(
    refreshToken: string,
    calendarId: string,
    eventId: string,
    changes: Partial<Omit<CalendarEventFields, "attendees">>,
    notify: boolean,
  ): Promise<NormalizedCalendarEvent>;
  cancel(refreshToken: string, calendarId: string, eventId: string, notify: boolean): Promise<void>;
}

const PRIMARY = "primary";

function toRequestBody(fields: Partial<CalendarEventFields>): calendar_v3.Schema$Event {
  return {
    ...(fields.title !== undefined ? { summary: fields.title } : {}),
    ...(fields.start ? { start: { dateTime: fields.start.toISOString() } } : {}),
    ...(fields.end ? { end: { dateTime: fields.end.toISOString() } } : {}),
    ...(fields.location !== undefined ? { location: fields.location } : {}),
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    ...(fields.attendees ? { attendees: fields.attendees.map((email) => ({ email })) } : {}),
  };
}

export function createCalendarWriteService(dependencies?: { oauth?: GoogleOAuthService }): CalendarWriteService {
  const oauth = dependencies?.oauth ?? createGoogleOAuthService();
  const client = (refreshToken: string) => google.calendar({ version: "v3", auth: oauth.createAuthorizedClient(refreshToken) });

  return {
    async create(refreshToken, fields) {
      try {
        const res = await client(refreshToken).events.insert({
          calendarId: PRIMARY,
          sendUpdates: fields.attendees.length > 0 ? "all" : "none",
          requestBody: toRequestBody(fields),
        });
        return normalizeEvent(res.data, PRIMARY);
      } catch (err) {
        throw mapGoogleApiError(err, "Google Calendar");
      }
    },
    async update(refreshToken, calendarId, eventId, changes, notify) {
      try {
        const res = await client(refreshToken).events.patch({
          calendarId,
          eventId,
          sendUpdates: notify ? "all" : "none",
          requestBody: toRequestBody(changes),
        });
        return normalizeEvent(res.data, calendarId);
      } catch (err) {
        throw mapGoogleApiError(err, "Google Calendar");
      }
    },
    async cancel(refreshToken, calendarId, eventId, notify) {
      try {
        await client(refreshToken).events.delete({ calendarId, eventId, sendUpdates: notify ? "all" : "none" });
      } catch (err) {
        throw mapGoogleApiError(err, "Google Calendar");
      }
    },
  };
}
