import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../db/repositories/calendar-events.repository.js";
import type { Email } from "../db/repositories/emails.repository.js";
import type { Signal } from "../db/repositories/interventions.repository.js";
import { createSituationPrioritizationService } from "./situation-prioritization.service.js";
import type { ConsolidatedSituationsService } from "./consolidated-situations.service.js";
import type { PrioritizationService } from "./prioritization/prioritization.service.js";
import type { ConsolidatedSituation } from "./context/consolidated-situation.types.js";
import type { EmailsRepository } from "../db/repositories/emails.repository.js";
import type { CalendarEventsRepository } from "../db/repositories/calendar-events.repository.js";
import type { SignalsRepository } from "../db/repositories/interventions.repository.js";
import type { Goal } from "@prisma/client";
import type { GoalsRepository } from "../db/repositories/goals.repository.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeSituation(overrides: Partial<ConsolidatedSituation> = {}): ConsolidatedSituation {
  return {
    id: "email_signal:calendar_signal",
    signalIds: ["email_signal", "calendar_signal"],
    primarySignalId: "calendar_signal",
    emailIds: ["email_1"],
    calendarEventIds: ["event_1"],
    relationship: { type: "attendee_match", strength: "strong" },
    ...overrides,
  };
}

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "email_1",
    userId: "user_1",
    providerMessageId: "msg_1",
    threadId: "thread_1",
    fromEmail: "john@acme.com",
    fromName: "John",
    toEmails: [],
    subject: "Acme proposal feedback",
    snippet: "notes",
    bodyText: null,
    receivedAt: NOW,
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
    id: "event_1",
    userId: "user_1",
    providerEventId: "evt_1",
    calendarId: "primary",
    title: "Acme proposal review",
    description: "should never be sent to the AI",
    location: null,
    startAt: new Date("2026-09-15T10:00:00.000Z"),
    endAt: new Date("2026-09-15T11:00:00.000Z"),
    isAllDay: false,
    status: "confirmed",
    organizerEmail: null,
    organizerName: null,
    attendeeEmails: ["john@acme.com"],
    attendees: [],
    sourceUrl: null,
    rawUpdatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "email_signal",
    userId: "user_1",
    type: "user_action_required",
    sourceType: "email",
    sourceId: "email_1",
    title: "x",
    summary: "y",
    dueAt: null,
    importanceHints: { confidence: "medium" },
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSituationsService(
  overrides: Partial<ConsolidatedSituationsService> = {},
): ConsolidatedSituationsService {
  return {
    getSituations: vi.fn().mockResolvedValue([makeSituation()]),
    ...overrides,
  };
}

function makeEmails(overrides: Partial<EmailsRepository> = {}): EmailsRepository {
  return {
    upsertEmail: vi.fn(),
    upsertMany: vi.fn(),
    findByProviderMessageId: vi.fn(),
    listRecent: vi.fn().mockResolvedValue([makeEmail()]),
    ...overrides,
  };
}

function makeEvents(overrides: Partial<CalendarEventsRepository> = {}): CalendarEventsRepository {
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
    listOpen: vi.fn().mockResolvedValue([
      makeSignal({ id: "email_signal", sourceType: "email", sourceId: "email_1" }),
      makeSignal({
        id: "calendar_signal",
        sourceType: "calendar_event",
        sourceId: "event_1",
        dueAt: new Date("2026-09-15T10:00:00.000Z"),
        importanceHints: { confidence: "high" },
      }),
    ]),
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

function makePrioritizationService(
  overrides: Partial<PrioritizationService> = {},
): PrioritizationService {
  return {
    prioritize: vi.fn().mockResolvedValue({
      ok: true,
      prioritizedSituations: [
        {
          situationId: "email_signal:calendar_signal",
          priority: "high",
          reason: "r",
          recommendedAction: "a",
        },
      ],
    }),
    ...overrides,
  };
}

describe("situation prioritization service (orchestration)", () => {
  it("loads situations and related data, then builds bounded input for the AI layer", async () => {
    const prioritization = makePrioritizationService();
    const service = createSituationPrioritizationService({
      situations: makeSituationsService(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      goals: makeGoalsRepo(),
      prioritization,
    });

    const result = await service.prioritize("user_1", NOW);

    expect(result.ok).toBe(true);
    expect(prioritization.prioritize).toHaveBeenCalledTimes(1);
    const input = (prioritization.prioritize as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(input.situations).toHaveLength(1);
    expect(input.situations[0].email.fromEmail).toBe("john@acme.com");
    expect(input.situations[0].calendarEvent.summary).toBe("Acme proposal review");
  });

  it("never leaks the calendar event description into the AI input", async () => {
    const prioritization = makePrioritizationService();
    const service = createSituationPrioritizationService({
      situations: makeSituationsService(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      goals: makeGoalsRepo(),
      prioritization,
    });

    await service.prioritize("user_1", NOW);

    const input = (prioritization.prioritize as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(JSON.stringify(input)).not.toMatch(/should never be sent to the AI/);
  });

  it("returns an empty result without loading emails/events/signals when there are no situations", async () => {
    const emails = makeEmails();
    const events = makeEvents();
    const signalsRepo = makeSignalsRepo();
    const goalsRepo = makeGoalsRepo();
    const service = createSituationPrioritizationService({
      situations: makeSituationsService({ getSituations: vi.fn().mockResolvedValue([]) }),
      emails,
      events,
      signals: signalsRepo,
      goals: goalsRepo,
      prioritization: makePrioritizationService(),
    });

    const result = await service.prioritize("user_1", NOW);

    expect(result).toEqual({ ok: true, prioritizedSituations: [] });
    expect(emails.listRecent).not.toHaveBeenCalled();
    expect(events.listUpcoming).not.toHaveBeenCalled();
    expect(signalsRepo.listOpen).not.toHaveBeenCalled();
    expect(goalsRepo.listActive).not.toHaveBeenCalled();
  });

  it("propagates a provider failure from the core prioritization service unchanged", async () => {
    const prioritization = makePrioritizationService({
      prioritize: vi
        .fn()
        .mockResolvedValue({ ok: false, code: "provider_error", message: "unavailable" }),
    });
    const service = createSituationPrioritizationService({
      situations: makeSituationsService(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      goals: makeGoalsRepo(),
      prioritization,
    });

    const result = await service.prioritize("user_1", NOW);

    expect(result).toEqual({ ok: false, code: "provider_error", message: "unavailable" });
  });

  it("includes the Phase 3.2 daily-context fields (currentTime/upcomingEvents/relevantEmails) alongside situations", async () => {
    const prioritization = makePrioritizationService();
    const service = createSituationPrioritizationService({
      situations: makeSituationsService(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      goals: makeGoalsRepo(),
      prioritization,
    });

    await service.prioritize("user_1", NOW);

    const input = (prioritization.prioritize as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(input.currentTime).toBe(NOW.toISOString());
    expect(Array.isArray(input.upcomingEvents)).toBe(true);
    expect(Array.isArray(input.relevantEmails)).toBe(true);
  });

  it("does not include a goals field when there are no active goals", async () => {
    const prioritization = makePrioritizationService();
    const service = createSituationPrioritizationService({
      situations: makeSituationsService(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      goals: makeGoalsRepo(),
      prioritization,
    });

    await service.prioritize("user_1", NOW);

    const input = (prioritization.prioritize as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(input.goals).toBeUndefined();
  });

  it("includes active goals (Phase 3.4) in the AI input, bounded to id/title/description", async () => {
    const prioritization = makePrioritizationService();
    const goalsRepo = makeGoalsRepo({
      listActive: vi.fn().mockResolvedValue([
        makeGoal({ id: "goal_1", title: "Launch my product", description: "v1 by Q4" }),
      ]),
    });
    const service = createSituationPrioritizationService({
      situations: makeSituationsService(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      goals: goalsRepo,
      prioritization,
    });

    await service.prioritize("user_1", NOW);

    expect(goalsRepo.listActive).toHaveBeenCalledWith("user_1");
    const input = (prioritization.prioritize as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(input.goals).toEqual([
      { id: "goal_1", title: "Launch my product", description: "v1 by Q4" },
    ]);
  });

  it("derives signal confidence from importanceHints and passes it through", async () => {
    const prioritization = makePrioritizationService();
    const service = createSituationPrioritizationService({
      situations: makeSituationsService(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      goals: makeGoalsRepo(),
      prioritization,
    });

    await service.prioritize("user_1", NOW);

    const input = (prioritization.prioritize as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const confidences = input.situations[0].signals.map((s: { confidence: string }) => s.confidence);
    expect(confidences.sort()).toEqual(["high", "medium"]);
  });
});
