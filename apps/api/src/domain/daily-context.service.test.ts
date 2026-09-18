import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../db/repositories/calendar-events.repository.js";
import type { Email } from "../db/repositories/emails.repository.js";
import type { Signal } from "../db/repositories/interventions.repository.js";
import { createDailyContextService } from "./daily-context.service.js";
import type { ConsolidatedSituationsService } from "./consolidated-situations.service.js";
import type { EmailsRepository } from "../db/repositories/emails.repository.js";
import type { CalendarEventsRepository } from "../db/repositories/calendar-events.repository.js";
import type { SignalsRepository } from "../db/repositories/interventions.repository.js";
import type { Goal } from "@prisma/client";
import type { GoalsRepository } from "../db/repositories/goals.repository.js";
import type { ConsolidatedSituation } from "./context/consolidated-situation.types.js";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "e1",
    userId: "user_1",
    providerMessageId: "msg1",
    threadId: "t1",
    fromEmail: "john@acme.com",
    fromName: "John",
    toEmails: [],
    subject: "Feedback needed",
    snippet: "Please review",
    bodyText: null,
    receivedAt: new Date("2026-09-16T06:00:00.000Z"),
    isRead: false,
    labels: [],
    sourceUrl: null,
    rawUpdatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "c1",
    userId: "user_1",
    providerEventId: "evt1",
    calendarId: "primary",
    title: "Acme review",
    description: "secret notes",
    location: null,
    startAt: new Date("2026-09-16T18:00:00.000Z"),
    endAt: new Date("2026-09-16T19:00:00.000Z"),
    isAllDay: false,
    status: "confirmed",
    organizerEmail: null,
    organizerName: null,
    attendeeEmails: ["john@acme.com"],
    attendees: null,
    sourceUrl: null,
    rawUpdatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "sig1",
    userId: "user_1",
    type: "user_action_required",
    sourceType: "email",
    sourceId: "e1",
    title: "John needs a response",
    summary: "reason",
    dueAt: null,
    importanceHints: { confidence: "high" },
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const SITUATION: ConsolidatedSituation = {
  id: "s1",
  signalIds: ["sig1"],
  primarySignalId: "sig1",
  emailIds: ["e1"],
  calendarEventIds: [],
  relationship: { type: "topic_overlap", strength: "possible" },
};

function makeEmailsRepo(overrides: Partial<EmailsRepository> = {}): EmailsRepository {
  return {
    upsertEmail: vi.fn(),
    upsertMany: vi.fn(),
    findByProviderMessageId: vi.fn(),
    listRecent: vi.fn().mockResolvedValue([makeEmail()]),
    ...overrides,
  };
}

function makeEventsRepo(
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

function makeSignalsRepo(overrides: Partial<SignalsRepository> = {}): SignalsRepository {
  return {
    findUniqueKey: vi.fn(),
    listOpen: vi.fn().mockResolvedValue([makeSignal()]),
    create: vi.fn(),
    ...overrides,
  };
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal_1",
    userId: "user_1",
    title: "Launch my product",
    description: null,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeGoalsRepo(overrides: Partial<GoalsRepository> = {}): GoalsRepository {
  return {
    create: vi.fn(),
    listAll: vi.fn().mockResolvedValue([]),
    listActive: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

function makeSituationsService(
  overrides: Partial<ConsolidatedSituationsService> = {},
): ConsolidatedSituationsService {
  return {
    getSituations: vi.fn().mockResolvedValue([SITUATION]),
    ...overrides,
  };
}

describe("daily context service", () => {
  it("loads from all four existing sources and builds a bounded context", async () => {
    const emails = makeEmailsRepo();
    const events = makeEventsRepo();
    const signals = makeSignalsRepo();
    const situations = makeSituationsService();
    const goals = makeGoalsRepo({
      listActive: vi.fn().mockResolvedValue([makeGoal()]),
    });
    const service = createDailyContextService({ emails, events, signals, situations, goals });

    const context = await service.getDailyContext("user_1", NOW);

    expect(emails.listRecent).toHaveBeenCalledWith("user_1", expect.any(Number));
    expect(events.listUpcoming).toHaveBeenCalledWith("user_1", expect.any(Number), NOW);
    expect(signals.listOpen).toHaveBeenCalledWith("user_1");
    expect(situations.getSituations).toHaveBeenCalledWith("user_1", NOW);
    expect(goals.listActive).toHaveBeenCalledWith("user_1");

    expect(context.currentTime).toBe(NOW.toISOString());
    expect(context.relevantEmails).toHaveLength(1);
    expect(context.upcomingEvents).toHaveLength(1);
    expect(context.activeSignals).toHaveLength(1);
    expect(context.consolidatedSituations).toEqual([SITUATION]);
    expect(context.goals).toEqual([
      { id: "goal_1", title: "Launch my product", description: null },
    ]);
  });

  it("never leaks email body or calendar description into the context", async () => {
    const service = createDailyContextService({
      emails: makeEmailsRepo(),
      events: makeEventsRepo(),
      signals: makeSignalsRepo(),
      situations: makeSituationsService(),
      goals: makeGoalsRepo(),
    });

    const context = await service.getDailyContext("user_1", NOW);

    expect(context.relevantEmails[0]).not.toHaveProperty("bodyText");
    expect(context.upcomingEvents[0]).not.toHaveProperty("description");
    expect(JSON.stringify(context)).not.toMatch(/secret notes/);
  });

  it("excludes an email outside the 24h window even though the repository returned it", async () => {
    const service = createDailyContextService({
      emails: makeEmailsRepo({
        listRecent: vi
          .fn()
          .mockResolvedValue([makeEmail({ receivedAt: new Date("2026-09-10T00:00:00.000Z") })]),
      }),
      events: makeEventsRepo({ listUpcoming: vi.fn().mockResolvedValue([]) }),
      signals: makeSignalsRepo({ listOpen: vi.fn().mockResolvedValue([]) }),
      situations: makeSituationsService({ getSituations: vi.fn().mockResolvedValue([]) }),
      goals: makeGoalsRepo(),
    });

    const context = await service.getDailyContext("user_1", NOW);

    expect(context.relevantEmails).toEqual([]);
  });

  it("returns a fully empty context when the user has no data", async () => {
    const service = createDailyContextService({
      emails: makeEmailsRepo({ listRecent: vi.fn().mockResolvedValue([]) }),
      events: makeEventsRepo({ listUpcoming: vi.fn().mockResolvedValue([]) }),
      signals: makeSignalsRepo({ listOpen: vi.fn().mockResolvedValue([]) }),
      situations: makeSituationsService({ getSituations: vi.fn().mockResolvedValue([]) }),
      goals: makeGoalsRepo(),
    });

    const context = await service.getDailyContext("user_1", NOW);

    expect(context).toEqual({
      currentTime: NOW.toISOString(),
      upcomingEvents: [],
      relevantEmails: [],
      activeSignals: [],
      consolidatedSituations: [],
      goals: [],
    });
  });

  it("creates no Signal, Intervention, or Goal rows (read-only) — never calls a write method", async () => {
    const emails = makeEmailsRepo();
    const events = makeEventsRepo();
    const signals = makeSignalsRepo();
    const goals = makeGoalsRepo();
    const service = createDailyContextService({
      emails,
      events,
      signals,
      situations: makeSituationsService(),
      goals,
    });

    await service.getDailyContext("user_1", NOW);

    expect(signals.create).not.toHaveBeenCalled();
    expect(goals.create).not.toHaveBeenCalled();
  });
});
