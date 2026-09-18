import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../db/repositories/calendar-events.repository.js";
import type { Intervention, Signal } from "../db/repositories/interventions.repository.js";
import {
  CALENDAR_SIGNAL_DETECTION_DEFAULT_LIMIT,
  CALENDAR_SIGNAL_DETECTION_MAX_LIMIT,
  clampCalendarDetectionLimit,
  createCalendarSignalDetectionService,
} from "./calendar-signal-detection.service.js";
import type { CalendarEventsRepository } from "../db/repositories/calendar-events.repository.js";
import type {
  InterventionsRepository,
  SignalsRepository,
} from "../db/repositories/interventions.repository.js";

const NOW = new Date("2026-09-14T16:00:00.000Z");

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt_1",
    userId: "user_1",
    providerEventId: "provider-evt-1",
    calendarId: "primary",
    title: "Client meeting",
    description: "Discuss contract renewal",
    location: null,
    startAt: minutesFromNow(8),
    endAt: minutesFromNow(38),
    isAllDay: false,
    status: "confirmed",
    organizerEmail: "organizer@example.com",
    organizerName: "Org",
    attendeeEmails: [],
    attendees: [],
    sourceUrl: "https://calendar.google.com/event?eid=evt_1",
    rawUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "signal_1",
    userId: "user_1",
    type: "user_action_required",
    sourceType: "calendar_event",
    sourceId: "evt_1",
    title: "Client meeting",
    summary: "reason",
    dueAt: null,
    importanceHints: null,
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  return {
    id: "int_1",
    userId: "user_1",
    signalId: "signal_1",
    status: "pending",
    priority: "high",
    title: "Client meeting",
    message: "reason",
    reason: "reason",
    actionType: "open_source",
    actionPayload: null,
    snoozedUntil: null,
    createdAt: new Date(),
    resolvedAt: null,
    lastDeliveredAt: null,
    ...overrides,
  };
}

function makeEvents(
  overrides: Partial<CalendarEventsRepository> = {},
): CalendarEventsRepository {
  return {
    upsertEvent: vi.fn(),
    upsertMany: vi.fn(),
    findByProviderEventId: vi.fn(),
    listUpcoming: vi.fn().mockResolvedValue([makeEvent()]),
    ...overrides,
  };
}

function makeSignals(overrides: Partial<SignalsRepository> = {}): SignalsRepository {
  return {
    findUniqueKey: vi.fn().mockResolvedValue(null),
    listOpen: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(makeSignal()),
    ...overrides,
  };
}

function makeInterventions(
  overrides: Partial<InterventionsRepository> = {},
): InterventionsRepository {
  return {
    findBySignalId: vi.fn().mockResolvedValue(null),
    listInbox: vi.fn(),
    findById: vi.fn(),
    create: vi.fn().mockResolvedValue(makeIntervention()),
    resolve: vi.fn(),
    snooze: vi.fn(),
    ...overrides,
  };
}

describe("clampCalendarDetectionLimit", () => {
  it("defaults when no limit is requested", () => {
    expect(clampCalendarDetectionLimit(undefined)).toBe(
      CALENDAR_SIGNAL_DETECTION_DEFAULT_LIMIT,
    );
  });
  it("caps at the safe maximum", () => {
    expect(clampCalendarDetectionLimit(9999)).toBe(CALENDAR_SIGNAL_DETECTION_MAX_LIMIT);
  });
  it("floors below 1", () => {
    expect(clampCalendarDetectionLimit(0)).toBe(1);
  });
});

describe("calendar signal detection service", () => {
  it("creates a signal and intervention for an actionable (soon-starting) event", async () => {
    const events = makeEvents();
    const signals = makeSignals();
    const interventions = makeInterventions();
    const service = createCalendarSignalDetectionService({ events, signals, interventions });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({
      analyzed: 1,
      actionable: 1,
      signalsCreated: 1,
      interventionsCreated: 1,
    });
    expect(signals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        type: "user_action_required",
        sourceType: "calendar_event",
        sourceId: "evt_1",
      }),
    );
    expect(interventions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        signalId: "signal_1",
        priority: "high",
        actionType: "open_source",
      }),
    );
  });

  it("does not create a signal for an event outside the attention window", async () => {
    const events = makeEvents({
      listUpcoming: vi.fn().mockResolvedValue([makeEvent({ startAt: minutesFromNow(120) })]),
    });
    const signals = makeSignals();
    const interventions = makeInterventions();
    const service = createCalendarSignalDetectionService({ events, signals, interventions });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({
      analyzed: 1,
      actionable: 0,
      signalsCreated: 0,
      interventionsCreated: 0,
    });
    expect(signals.create).not.toHaveBeenCalled();
    expect(interventions.create).not.toHaveBeenCalled();
  });

  it("does not create a signal for an all-day event", async () => {
    const events = makeEvents({
      listUpcoming: vi.fn().mockResolvedValue([makeEvent({ isAllDay: true })]),
    });
    const service = createCalendarSignalDetectionService({
      events,
      signals: makeSignals(),
      interventions: makeInterventions(),
    });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result.actionable).toBe(0);
  });

  it("does not create a duplicate signal when one already exists for the event", async () => {
    const existingSignal = makeSignal();
    const events = makeEvents();
    const signals = makeSignals({ findUniqueKey: vi.fn().mockResolvedValue(existingSignal) });
    const interventions = makeInterventions();
    const service = createCalendarSignalDetectionService({ events, signals, interventions });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result.signalsCreated).toBe(0);
    expect(result.actionable).toBe(1);
    expect(signals.create).not.toHaveBeenCalled();
    expect(interventions.create).toHaveBeenCalledTimes(1);
  });

  it("does not create a duplicate intervention when one already exists for the signal", async () => {
    const existingSignal = makeSignal();
    const existingIntervention = makeIntervention();
    const events = makeEvents();
    const signals = makeSignals({ findUniqueKey: vi.fn().mockResolvedValue(existingSignal) });
    const interventions = makeInterventions({
      findBySignalId: vi.fn().mockResolvedValue(existingIntervention),
    });
    const service = createCalendarSignalDetectionService({ events, signals, interventions });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({
      analyzed: 1,
      actionable: 1,
      signalsCreated: 0,
      interventionsCreated: 0,
    });
    expect(interventions.create).not.toHaveBeenCalled();
  });

  it("running detection twice in a row is fully idempotent", async () => {
    const store: { signal: Signal | null; intervention: Intervention | null } = {
      signal: null,
      intervention: null,
    };
    const signals = makeSignals({
      findUniqueKey: vi.fn(async () => store.signal),
      create: vi.fn(async (input) => {
        store.signal = makeSignal({ sourceId: input.sourceId });
        return store.signal;
      }),
    });
    const interventions = makeInterventions({
      findBySignalId: vi.fn(async () => store.intervention),
      create: vi.fn(async () => {
        store.intervention = makeIntervention();
        return store.intervention;
      }),
    });
    const events = makeEvents();
    const service = createCalendarSignalDetectionService({ events, signals, interventions });

    const first = await service.detectAndCreateInterventions("user_1", 10, NOW);
    const second = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(first).toEqual({ analyzed: 1, actionable: 1, signalsCreated: 1, interventionsCreated: 1 });
    expect(second).toEqual({ analyzed: 1, actionable: 1, signalsCreated: 0, interventionsCreated: 0 });
  });

  it("references the correct persisted CalendarEvent as the signal source", async () => {
    const event = makeEvent({ id: "evt_specific" });
    const events = makeEvents({ listUpcoming: vi.fn().mockResolvedValue([event]) });
    const signals = makeSignals();
    const interventions = makeInterventions();
    const service = createCalendarSignalDetectionService({ events, signals, interventions });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(signals.findUniqueKey).toHaveBeenCalledWith(
      "user_1",
      "user_action_required",
      "calendar_event",
      "evt_specific",
    );
    expect(signals.create).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "evt_specific", sourceType: "calendar_event" }),
    );
  });

  it("sets the signal's dueAt to the meeting start time", async () => {
    const startAt = minutesFromNow(8);
    const events = makeEvents({ listUpcoming: vi.fn().mockResolvedValue([makeEvent({ startAt })]) });
    const signals = makeSignals();
    const service = createCalendarSignalDetectionService({
      events,
      signals,
      interventions: makeInterventions(),
    });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    const createCall = (signals.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.dueAt).toEqual(startAt);
  });

  it("produces a human-readable intervention message, not a generic one", async () => {
    const interventions = makeInterventions();
    const service = createCalendarSignalDetectionService({
      events: makeEvents(),
      signals: makeSignals(),
      interventions,
    });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    const createCall = (interventions.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.message).not.toMatch(/you have a calendar event/i);
    expect(createCall.message).toMatch(/Client meeting starts in \d+ minutes?\./);
  });

  it("assigns high priority within 10 minutes and medium priority beyond that but within 30", async () => {
    const soonEvent = makeEvent({ id: "evt_soon", startAt: minutesFromNow(5) });
    const laterEvent = makeEvent({ id: "evt_later", startAt: minutesFromNow(25) });
    const events = makeEvents({
      listUpcoming: vi.fn().mockResolvedValue([soonEvent, laterEvent]),
    });
    const interventions = makeInterventions();
    const service = createCalendarSignalDetectionService({
      events,
      signals: makeSignals(),
      interventions,
    });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    const calls = (interventions.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0].priority).toBe("high");
    expect(calls[1]![0].priority).toBe("medium");
  });

  it("does not treat attendee presence as making an out-of-window event actionable", async () => {
    const events = makeEvents({
      listUpcoming: vi.fn().mockResolvedValue([
        makeEvent({
          startAt: minutesFromNow(120),
          attendees: [
            { email: "a@example.com", displayName: "A", responseStatus: "accepted" },
            { email: "b@example.com", displayName: "B", responseStatus: "accepted" },
          ],
        }),
      ]),
    });
    const service = createCalendarSignalDetectionService({
      events,
      signals: makeSignals(),
      interventions: makeInterventions(),
    });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result.actionable).toBe(0);
  });

  it("handles zero upcoming events without error", async () => {
    const events = makeEvents({ listUpcoming: vi.fn().mockResolvedValue([]) });
    const service = createCalendarSignalDetectionService({
      events,
      signals: makeSignals(),
      interventions: makeInterventions(),
    });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({ analyzed: 0, actionable: 0, signalsCreated: 0, interventionsCreated: 0 });
  });

  it("passes the clamped limit and `now` through to listUpcoming", async () => {
    const events = makeEvents();
    const service = createCalendarSignalDetectionService({
      events,
      signals: makeSignals(),
      interventions: makeInterventions(),
    });

    await service.detectAndCreateInterventions("user_1", 9999, NOW);

    expect(events.listUpcoming).toHaveBeenCalledWith(
      "user_1",
      CALENDAR_SIGNAL_DETECTION_MAX_LIMIT,
      NOW,
    );
  });
});
