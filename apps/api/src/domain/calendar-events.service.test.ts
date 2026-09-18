import { describe, expect, it, vi } from "vitest";
import {
  clampCalendarLimit,
  createCalendarEventsService,
} from "./calendar-events.service.js";
import type { GoogleConnectionService } from "./google-connection.service.js";
import { notFoundError, upstreamError } from "../lib/errors.js";
import type { CalendarService } from "../providers/google/calendar/calendar.service.js";
import {
  CALENDAR_DEFAULT_EVENT_LIMIT,
  CALENDAR_MAX_EVENT_LIMIT,
} from "../providers/google/calendar/calendar.types.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeConnection(
  overrides: Partial<GoogleConnectionService> = {},
): GoogleConnectionService {
  return {
    startConnect: vi.fn(),
    handleCallback: vi.fn(),
    getStatus: vi.fn(),
    disconnect: vi.fn(),
    getDecryptedRefreshToken: vi.fn().mockResolvedValue("stored-refresh-token"),
    ...overrides,
  };
}

function makeCalendar(overrides: Partial<CalendarService> = {}): CalendarService {
  return {
    listUpcomingEvents: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("clampCalendarLimit", () => {
  it("defaults when no limit is requested", () => {
    expect(clampCalendarLimit(undefined)).toBe(CALENDAR_DEFAULT_EVENT_LIMIT);
  });

  it("caps an excessive requested limit at the safe maximum", () => {
    expect(clampCalendarLimit(1000)).toBe(CALENDAR_MAX_EVENT_LIMIT);
  });

  it("floors a sub-1 or non-finite value to 1", () => {
    expect(clampCalendarLimit(0)).toBe(1);
    expect(clampCalendarLimit(-5)).toBe(1);
    expect(clampCalendarLimit(Number.NaN)).toBe(CALENDAR_DEFAULT_EVENT_LIMIT);
  });

  it("passes through an in-range value", () => {
    expect(clampCalendarLimit(7)).toBe(7);
  });
});

describe("calendar events service", () => {
  it("uses the decrypted refresh token from the connection service", async () => {
    const connection = makeConnection();
    const calendar = makeCalendar();
    const service = createCalendarEventsService({ connection, calendar });

    await service.listUpcomingEvents("user_1", 5, NOW);

    expect(connection.getDecryptedRefreshToken).toHaveBeenCalledWith("user_1");
    expect(calendar.listUpcomingEvents).toHaveBeenCalledWith(
      "stored-refresh-token",
      5,
      NOW,
    );
  });

  it("clamps the limit before calling the provider", async () => {
    const calendar = makeCalendar();
    const service = createCalendarEventsService({ connection: makeConnection(), calendar });

    await service.listUpcomingEvents("user_1", 999, NOW);

    expect(calendar.listUpcomingEvents).toHaveBeenCalledWith(
      "stored-refresh-token",
      CALENDAR_MAX_EVENT_LIMIT,
      NOW,
    );
  });

  it("returns the normalized events from the calendar provider", async () => {
    const normalized = [
      {
        id: "evt_1",
        calendarId: "primary",
        summary: "Standup",
        description: null,
        location: null,
        start: "2026-09-15T10:00:00.000Z",
        end: "2026-09-15T10:30:00.000Z",
        isAllDay: false,
        attendees: [],
        organizer: null,
        status: "confirmed",
        htmlLink: null,
      },
    ];
    const calendar = makeCalendar({
      listUpcomingEvents: vi.fn().mockResolvedValue(normalized),
    });
    const service = createCalendarEventsService({ connection: makeConnection(), calendar });

    const result = await service.listUpcomingEvents("user_1", undefined, NOW);

    expect(result).toEqual(normalized);
  });

  it("propagates a not_found error when no Google connection exists", async () => {
    const connection = makeConnection({
      getDecryptedRefreshToken: vi
        .fn()
        .mockRejectedValue(notFoundError("Google account is not connected.")),
    });
    const service = createCalendarEventsService({ connection, calendar: makeCalendar() });

    await expect(service.listUpcomingEvents("user_1")).rejects.toMatchObject({
      code: "not_found",
      statusCode: 404,
    });
  });

  it("propagates a safe upstream error when the stored token cannot be decrypted", async () => {
    const connection = makeConnection({
      getDecryptedRefreshToken: vi
        .fn()
        .mockRejectedValue(upstreamError("Stored Google credentials could not be read.")),
    });
    const service = createCalendarEventsService({ connection, calendar: makeCalendar() });

    await expect(service.listUpcomingEvents("user_1")).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("propagates a Calendar provider failure (e.g. revoked access) unchanged", async () => {
    const calendar = makeCalendar({
      listUpcomingEvents: vi.fn().mockRejectedValue(
        Object.assign(new Error("Calendar access was denied."), {
          code: "forbidden",
          statusCode: 403,
        }),
      ),
    });
    const service = createCalendarEventsService({ connection: makeConnection(), calendar });

    await expect(service.listUpcomingEvents("user_1")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
