import { describe, expect, it, vi } from "vitest";
import type { GoogleOAuthService } from "../oauth/google-oauth.service.js";

const eventsList = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    calendar: vi.fn().mockImplementation(() => ({
      events: { list: eventsList },
    })),
  },
}));

function makeOAuth(overrides: Partial<GoogleOAuthService> = {}): GoogleOAuthService {
  return {
    getAuthorizationUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
    refreshAccessToken: vi.fn(),
    createAuthorizedClient: vi.fn().mockReturnValue({ mockClient: true }),
    ...overrides,
  };
}

const NOW = new Date("2026-09-14T12:00:00.000Z");

describe("calendar service", () => {
  it("passes the decrypted refresh token to the OAuth client builder", async () => {
    eventsList.mockResolvedValue({ data: { items: [] } });
    const oauth = makeOAuth();
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth });

    await service.listUpcomingEvents("plain-refresh-token", 10, NOW);

    expect(oauth.createAuthorizedClient).toHaveBeenCalledWith("plain-refresh-token");
  });

  it("queries the primary calendar with timeMin, singleEvents and orderBy startTime", async () => {
    eventsList.mockResolvedValue({ data: { items: [] } });
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    await service.listUpcomingEvents("token", 10, NOW);

    expect(eventsList).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        timeMin: NOW.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 10,
      }),
    );
  });

  it("clamps the requested limit to the safe server-side maximum", async () => {
    eventsList.mockResolvedValue({ data: { items: [] } });
    const { createCalendarService } = await import("./calendar.service.js");
    const { CALENDAR_MAX_EVENT_LIMIT } = await import("./calendar.types.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    await service.listUpcomingEvents("token", 9999, NOW);

    expect(eventsList).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: CALENDAR_MAX_EVENT_LIMIT }),
    );
  });

  it("normalizes a timed event", async () => {
    eventsList.mockResolvedValue({
      data: {
        items: [
          {
            id: "evt_1",
            summary: "Launch review",
            description: "Discuss launch readiness",
            location: "Conference Room A",
            start: { dateTime: "2026-09-15T10:00:00-07:00", timeZone: "America/Los_Angeles" },
            end: { dateTime: "2026-09-15T11:00:00-07:00", timeZone: "America/Los_Angeles" },
            attendees: [
              { email: "a@example.com", displayName: "Alex", responseStatus: "accepted" },
            ],
            organizer: { email: "organizer@example.com", displayName: "Org" },
            status: "confirmed",
            htmlLink: "https://calendar.google.com/event?eid=evt_1",
          },
        ],
      },
    });
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    const [event] = await service.listUpcomingEvents("token", 10, NOW);

    expect(event).toEqual({
      id: "evt_1",
      calendarId: "primary",
      summary: "Launch review",
      description: "Discuss launch readiness",
      location: "Conference Room A",
      start: "2026-09-15T10:00:00-07:00",
      end: "2026-09-15T11:00:00-07:00",
      isAllDay: false,
      attendees: [{ email: "a@example.com", displayName: "Alex", responseStatus: "accepted" }],
      organizer: { email: "organizer@example.com", displayName: "Org" },
      status: "confirmed",
      htmlLink: "https://calendar.google.com/event?eid=evt_1",
    });
  });

  it("normalizes an all-day event using the date field, not dateTime", async () => {
    eventsList.mockResolvedValue({
      data: {
        items: [
          {
            id: "evt_allday",
            summary: "Company holiday",
            start: { date: "2026-09-20" },
            end: { date: "2026-09-21" },
          },
        ],
      },
    });
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    const [event] = await service.listUpcomingEvents("token", 10, NOW);

    expect(event?.isAllDay).toBe(true);
    expect(event?.start).toBe("2026-09-20");
    expect(event?.end).toBe("2026-09-21");
  });

  it("fills in null/empty defaults when fields are missing", async () => {
    eventsList.mockResolvedValue({ data: { items: [{ id: "evt_bare" }] } });
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    const [event] = await service.listUpcomingEvents("token", 10, NOW);

    expect(event).toEqual({
      id: "evt_bare",
      calendarId: "primary",
      summary: null,
      description: null,
      location: null,
      start: null,
      end: null,
      isAllDay: false,
      attendees: [],
      organizer: null,
      status: null,
      htmlLink: null,
    });
  });

  it("excludes cancelled events", async () => {
    eventsList.mockResolvedValue({
      data: {
        items: [
          { id: "evt_cancelled", status: "cancelled", summary: "Cancelled meeting" },
          { id: "evt_kept", status: "confirmed", summary: "Kept meeting" },
        ],
      },
    });
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    const events = await service.listUpcomingEvents("token", 10, NOW);

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("evt_kept");
  });

  it("returns an empty list for an empty calendar", async () => {
    eventsList.mockResolvedValue({ data: {} });
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    const events = await service.listUpcomingEvents("token", 10, NOW);

    expect(events).toEqual([]);
  });

  it("maps a Google auth failure (401) into a forbidden AppError without leaking details", async () => {
    eventsList.mockRejectedValue(
      Object.assign(new Error("invalid_grant: token expired"), { code: 401 }),
    );
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    await expect(service.listUpcomingEvents("token", 10, NOW)).rejects.toMatchObject({
      code: "forbidden",
      statusCode: 403,
    });
  });

  it("maps a Calendar API failure (5xx) into an upstream AppError", async () => {
    eventsList.mockRejectedValue(Object.assign(new Error("Backend Error"), { code: 503 }));
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    await expect(service.listUpcomingEvents("token", 10, NOW)).rejects.toMatchObject({
      code: "upstream_error",
      statusCode: 502,
    });
  });

  it("never includes the raw Google error message in the thrown AppError", async () => {
    eventsList.mockRejectedValue(
      new Error("diagnostic detail containing client_secret=abc123"),
    );
    const { createCalendarService } = await import("./calendar.service.js");
    const service = createCalendarService({ oauth: makeOAuth() });

    await expect(service.listUpcomingEvents("token", 10, NOW)).rejects.not.toMatchObject({
      message: expect.stringContaining("client_secret"),
    });
  });
});
