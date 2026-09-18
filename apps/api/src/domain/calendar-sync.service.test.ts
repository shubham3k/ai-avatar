import { describe, expect, it, vi } from "vitest";
import { createCalendarSyncService } from "./calendar-sync.service.js";
import type { GoogleConnectionService } from "./google-connection.service.js";
import { notFoundError } from "../lib/errors.js";
import type {
  CalendarEventsRepository,
  UpsertCalendarEventInput,
} from "../db/repositories/calendar-events.repository.js";
import type { CalendarService } from "../providers/google/calendar/calendar.service.js";
import type { NormalizedCalendarEvent } from "../providers/google/calendar/calendar.types.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeEvent(overrides: Partial<NormalizedCalendarEvent> = {}): NormalizedCalendarEvent {
  return {
    id: "evt-1",
    calendarId: "primary",
    summary: "Launch review",
    description: "Discuss launch readiness",
    location: "Conference Room A",
    start: "2026-09-15T10:00:00.000Z",
    end: "2026-09-15T11:00:00.000Z",
    isAllDay: false,
    attendees: [{ email: "a@example.com", displayName: "Alex", responseStatus: "accepted" }],
    organizer: { email: "organizer@example.com", displayName: "Org" },
    status: "confirmed",
    htmlLink: "https://calendar.google.com/event?eid=evt-1",
    ...overrides,
  };
}

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
    listUpcomingEvents: vi.fn().mockResolvedValue([makeEvent()]),
    ...overrides,
  };
}

function makeEvents(overrides: Partial<CalendarEventsRepository> = {}): CalendarEventsRepository {
  return {
    upsertEvent: vi.fn(),
    upsertMany: vi.fn().mockResolvedValue({ created: 1, updated: 0 }),
    findByProviderEventId: vi.fn(),
    listUpcoming: vi.fn(),
    ...overrides,
  };
}

describe("calendar sync service", () => {
  it("fetches events via the existing Calendar service using the decrypted refresh token", async () => {
    const connection = makeConnection();
    const calendar = makeCalendar();
    const service = createCalendarSyncService({ connection, calendar, events: makeEvents() });

    await service.sync("user_1", 5, NOW);

    expect(connection.getDecryptedRefreshToken).toHaveBeenCalledWith("user_1");
    expect(calendar.listUpcomingEvents).toHaveBeenCalledWith("stored-refresh-token", 5, NOW);
  });

  it("transforms normalized events into calendar-event persistence input and upserts them", async () => {
    const events = makeEvents();
    const service = createCalendarSyncService({
      connection: makeConnection(),
      calendar: makeCalendar(),
      events,
    });

    await service.sync("user_1", undefined, NOW);

    expect(events.upsertMany).toHaveBeenCalledTimes(1);
    const inputs = (events.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertCalendarEventInput[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      userId: "user_1",
      providerEventId: "evt-1",
      calendarId: "primary",
      title: "Launch review",
      description: "Discuss launch readiness",
      location: "Conference Room A",
      isAllDay: false,
      status: "confirmed",
      organizerEmail: "organizer@example.com",
      organizerName: "Org",
      attendeeEmails: ["a@example.com"],
    });
    expect(inputs[0]?.startAt.toISOString()).toBe("2026-09-15T10:00:00.000Z");
    expect(inputs[0]?.endAt.toISOString()).toBe("2026-09-15T11:00:00.000Z");
  });

  it("anchors an all-day event's date-only start/end to UTC midnight", async () => {
    const calendar = makeCalendar({
      listUpcomingEvents: vi.fn().mockResolvedValue([
        makeEvent({ isAllDay: true, start: "2026-09-20", end: "2026-09-21" }),
      ]),
    });
    const events = makeEvents();
    const service = createCalendarSyncService({ connection: makeConnection(), calendar, events });

    await service.sync("user_1", undefined, NOW);

    const inputs = (events.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertCalendarEventInput[];
    expect(inputs[0]?.isAllDay).toBe(true);
    expect(inputs[0]?.startAt.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(inputs[0]?.endAt.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("skips an event with a missing/unparsable start or end instead of crashing", async () => {
    const calendar = makeCalendar({
      listUpcomingEvents: vi
        .fn()
        .mockResolvedValue([makeEvent({ start: null }), makeEvent({ id: "evt-2", end: null })]),
    });
    const events = makeEvents({ upsertMany: vi.fn().mockResolvedValue({ created: 0, updated: 0 }) });
    const service = createCalendarSyncService({ connection: makeConnection(), calendar, events });

    const result = await service.sync("user_1", undefined, NOW);

    expect(events.upsertMany).toHaveBeenCalledWith([]);
    // "fetched" still reflects what Calendar returned, even if some were unpersistable.
    expect(result.fetched).toBe(2);
  });

  it("falls back to a placeholder title when summary is missing", async () => {
    const calendar = makeCalendar({
      listUpcomingEvents: vi.fn().mockResolvedValue([makeEvent({ summary: null })]),
    });
    const events = makeEvents();
    const service = createCalendarSyncService({ connection: makeConnection(), calendar, events });

    await service.sync("user_1", undefined, NOW);

    const inputs = (events.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertCalendarEventInput[];
    expect(inputs[0]?.title).toBe("(no title)");
  });

  it("handles a missing organizer without crashing", async () => {
    const calendar = makeCalendar({
      listUpcomingEvents: vi.fn().mockResolvedValue([makeEvent({ organizer: null, attendees: [] })]),
    });
    const events = makeEvents();
    const service = createCalendarSyncService({ connection: makeConnection(), calendar, events });

    await service.sync("user_1", undefined, NOW);

    const inputs = (events.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertCalendarEventInput[];
    expect(inputs[0]?.organizerEmail).toBeNull();
    expect(inputs[0]?.organizerName).toBeNull();
    expect(inputs[0]?.attendeeEmails).toEqual([]);
  });

  it("returns a summary of fetched/created/updated counts", async () => {
    const events = makeEvents({ upsertMany: vi.fn().mockResolvedValue({ created: 2, updated: 1 }) });
    const calendar = makeCalendar({
      listUpcomingEvents: vi
        .fn()
        .mockResolvedValue([makeEvent({ id: "a" }), makeEvent({ id: "b" }), makeEvent({ id: "c" })]),
    });
    const service = createCalendarSyncService({ connection: makeConnection(), calendar, events });

    const result = await service.sync("user_1", undefined, NOW);

    expect(result).toEqual({ fetched: 3, created: 2, updated: 1 });
  });

  it("does no persistence work when Calendar returns no events", async () => {
    const calendar = makeCalendar({ listUpcomingEvents: vi.fn().mockResolvedValue([]) });
    const events = makeEvents({ upsertMany: vi.fn().mockResolvedValue({ created: 0, updated: 0 }) });
    const service = createCalendarSyncService({ connection: makeConnection(), calendar, events });

    const result = await service.sync("user_1", undefined, NOW);

    expect(result).toEqual({ fetched: 0, created: 0, updated: 0 });
    expect(events.upsertMany).toHaveBeenCalledWith([]);
  });

  it("propagates a not_found error when Google is not connected, without touching the repository", async () => {
    const connection = makeConnection({
      getDecryptedRefreshToken: vi
        .fn()
        .mockRejectedValue(notFoundError("Google account is not connected.")),
    });
    const events = makeEvents();
    const service = createCalendarSyncService({ connection, calendar: makeCalendar(), events });

    await expect(service.sync("user_1")).rejects.toMatchObject({ code: "not_found" });
    expect(events.upsertMany).not.toHaveBeenCalled();
  });

  it("propagates a Calendar provider failure unchanged, without touching the repository", async () => {
    const calendar = makeCalendar({
      listUpcomingEvents: vi.fn().mockRejectedValue(
        Object.assign(new Error("Calendar access was denied."), {
          code: "forbidden",
          statusCode: 403,
        }),
      ),
    });
    const events = makeEvents();
    const service = createCalendarSyncService({ connection: makeConnection(), calendar, events });

    await expect(service.sync("user_1")).rejects.toMatchObject({ statusCode: 403 });
    expect(events.upsertMany).not.toHaveBeenCalled();
  });

  it("is idempotent: syncing the same events twice does not change the fetched count semantics", async () => {
    const events = makeEvents({
      upsertMany: vi
        .fn()
        .mockResolvedValueOnce({ created: 1, updated: 0 })
        .mockResolvedValueOnce({ created: 0, updated: 1 }),
    });
    const service = createCalendarSyncService({
      connection: makeConnection(),
      calendar: makeCalendar(),
      events,
    });

    const first = await service.sync("user_1", undefined, NOW);
    const second = await service.sync("user_1", undefined, NOW);

    expect(first).toEqual({ fetched: 1, created: 1, updated: 0 });
    expect(second).toEqual({ fetched: 1, created: 0, updated: 1 });
  });
});
