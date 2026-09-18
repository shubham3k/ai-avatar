export const CALENDAR_DEFAULT_EVENT_LIMIT = 10;
export const CALENDAR_MAX_EVENT_LIMIT = 25;

export const PRIMARY_CALENDAR_ID = "primary";

export interface NormalizedCalendarAttendee {
  email: string | null;
  displayName: string | null;
  responseStatus: string | null;
}

export interface NormalizedCalendarOrganizer {
  email: string | null;
  displayName: string | null;
}

export interface NormalizedCalendarEvent {
  id: string;
  calendarId: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  /** ISO datetime for a timed event, or "YYYY-MM-DD" for an all-day event. */
  start: string | null;
  end: string | null;
  isAllDay: boolean;
  attendees: NormalizedCalendarAttendee[];
  organizer: NormalizedCalendarOrganizer | null;
  status: string | null;
  htmlLink: string | null;
}
