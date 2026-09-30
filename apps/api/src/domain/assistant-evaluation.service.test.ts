import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../db/repositories/calendar-events.repository.js";
import type { Email } from "../db/repositories/emails.repository.js";
import type { Intervention, Signal } from "../db/repositories/interventions.repository.js";
import { createAssistantEvaluationService } from "./assistant-evaluation.service.js";
import type { ConsolidatedSituationsService } from "./consolidated-situations.service.js";
import type { SituationPrioritizationService } from "./situation-prioritization.service.js";
import type { ConsolidatedSituation } from "./context/consolidated-situation.types.js";
import type { EmailsRepository } from "../db/repositories/emails.repository.js";
import type { CalendarEventsRepository } from "../db/repositories/calendar-events.repository.js";
import type { InterventionsRepository, SignalsRepository } from "../db/repositories/interventions.repository.js";

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
    sourceUrl: "https://mail.google.com/mail/u/0/#all/msg",
    rawUpdatedAt: null,
    sentAnalyzedAt: null,
    expectsReply: null,
    followUpCheckedAt: null,
    repliedAt: null,
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
    description: null,
    location: null,
    startAt: new Date("2026-09-15T10:00:00.000Z"),
    endAt: new Date("2026-09-15T11:00:00.000Z"),
    isAllDay: false,
    status: "confirmed",
    organizerEmail: null,
    organizerName: null,
    attendeeEmails: ["john@acme.com"],
    attendees: [],
    sourceUrl: "https://calendar.google.com/event?eid=evt",
    rawUpdatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "calendar_signal",
    userId: "user_1",
    type: "user_action_required",
    sourceType: "calendar_event",
    sourceId: "event_1",
    title: "Acme proposal review",
    summary: "y",
    dueAt: new Date("2026-09-15T10:00:00.000Z"),
    importanceHints: { confidence: "high" },
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  return {
    id: "int_1",
    userId: "user_1",
    signalId: "calendar_signal",
    status: "pending",
    priority: "high",
    title: "x",
    message: "y",
    reason: "z",
    actionType: "open_source",
    actionPayload: null,
    snoozedUntil: null,
    createdAt: NOW,
    resolvedAt: null,
    lastDeliveredAt: null,
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

function makePrioritization(
  overrides: Partial<SituationPrioritizationService> = {},
): SituationPrioritizationService {
  return {
    prioritize: vi.fn().mockResolvedValue({
      ok: true,
      prioritizedSituations: [
        {
          situationId: "email_signal:calendar_signal",
          priority: "high",
          reason: "The email requests the proposal before tomorrow's review.",
          recommendedAction: "Send the proposal before the meeting.",
        },
      ],
    }),
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
      makeSignal(),
    ]),
    create: vi.fn(),
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

describe("assistant evaluation service", () => {
  it("creates a new intervention for an eligible high-priority situation", async () => {
    const interventions = makeInterventions();
    const service = createAssistantEvaluationService({
      situations: makeSituationsService(),
      situationPrioritization: makePrioritization(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      interventions,
    });

    const result = await service.evaluate("user_1", NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        situationId: "email_signal:calendar_signal",
        eligible: true,
        priority: "high",
        outcome: "created",
      });
      expect(result.results[0]?.interventionId).toBeTruthy();
    }
    expect(interventions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        signalId: "calendar_signal",
        priority: "high",
        actionType: "open_source",
        actionPayload: expect.objectContaining({
          sourceUrl: "https://calendar.google.com/event?eid=evt",
        }),
      }),
    );
  });

  it("reuses an already-pending intervention instead of creating a duplicate", async () => {
    const interventions = makeInterventions({
      findBySignalId: vi.fn().mockImplementation(async (signalId: string) =>
        signalId === "calendar_signal" ? makeIntervention() : null,
      ),
    });
    const service = createAssistantEvaluationService({
      situations: makeSituationsService(),
      situationPrioritization: makePrioritization(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      interventions,
    });

    const result = await service.evaluate("user_1", NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.results[0]).toMatchObject({ outcome: "reused", interventionId: "int_1" });
    }
    expect(interventions.create).not.toHaveBeenCalled();
  });

  it("is idempotent across repeated evaluation: second run reuses, never duplicates", async () => {
    const store: { intervention: Intervention | null } = { intervention: null };
    const interventions = makeInterventions({
      findBySignalId: vi.fn(async () => store.intervention),
      create: vi.fn(async (input) => {
        store.intervention = makeIntervention({ signalId: input.signalId });
        return store.intervention;
      }),
    });
    const service = createAssistantEvaluationService({
      situations: makeSituationsService(),
      situationPrioritization: makePrioritization(),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      interventions,
    });

    const first = await service.evaluate("user_1", NOW);
    const second = await service.evaluate("user_1", NOW);

    expect(first.ok && first.results[0]?.outcome).toBe("created");
    expect(second.ok && second.results[0]?.outcome).toBe("reused");
    expect(interventions.create).toHaveBeenCalledTimes(1);
  });

  it("does not surface a low-priority situation and creates no intervention", async () => {
    const interventions = makeInterventions();
    const service = createAssistantEvaluationService({
      situations: makeSituationsService(),
      situationPrioritization: makePrioritization({
        prioritize: vi.fn().mockResolvedValue({
          ok: true,
          prioritizedSituations: [
            {
              situationId: "email_signal:calendar_signal",
              priority: "low",
              reason: "r",
              recommendedAction: "a",
            },
          ],
        }),
      }),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      interventions,
    });

    const result = await service.evaluate("user_1", NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.results[0]).toMatchObject({ eligible: false, outcome: "skipped" });
    }
    expect(interventions.create).not.toHaveBeenCalled();
  });

  it("does not create an intervention for a situation the AI omitted", async () => {
    const interventions = makeInterventions();
    const service = createAssistantEvaluationService({
      situations: makeSituationsService(),
      situationPrioritization: makePrioritization({
        prioritize: vi.fn().mockResolvedValue({ ok: true, prioritizedSituations: [] }),
      }),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      interventions,
    });

    const result = await service.evaluate("user_1", NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.results[0]?.outcome).toBe("skipped");
    }
    expect(interventions.create).not.toHaveBeenCalled();
  });

  it("returns an empty result and calls neither AI nor repositories when there are no situations", async () => {
    const emails = makeEmails();
    const prioritization = makePrioritization();
    const service = createAssistantEvaluationService({
      situations: makeSituationsService({ getSituations: vi.fn().mockResolvedValue([]) }),
      situationPrioritization: prioritization,
      emails,
      events: makeEvents(),
      signals: makeSignalsRepo(),
      interventions: makeInterventions(),
    });

    const result = await service.evaluate("user_1", NOW);

    expect(result).toEqual({ ok: true, results: [] });
    expect(prioritization.prioritize).not.toHaveBeenCalled();
    expect(emails.listRecent).not.toHaveBeenCalled();
  });

  it("propagates an AI failure without creating any intervention", async () => {
    const interventions = makeInterventions();
    const service = createAssistantEvaluationService({
      situations: makeSituationsService(),
      situationPrioritization: makePrioritization({
        prioritize: vi
          .fn()
          .mockResolvedValue({ ok: false, code: "provider_error", message: "unavailable" }),
      }),
      emails: makeEmails(),
      events: makeEvents(),
      signals: makeSignalsRepo(),
      interventions,
    });

    const result = await service.evaluate("user_1", NOW);

    expect(result).toEqual({ ok: false, code: "provider_error", message: "unavailable" });
    expect(interventions.create).not.toHaveBeenCalled();
  });

  it("handles multiple independent situations correctly", async () => {
    const situationA = makeSituation({
      id: "sA",
      signalIds: ["sigA1", "sigA2"],
      primarySignalId: "sigA2",
      emailIds: ["emailA"],
      calendarEventIds: ["eventA"],
    });
    const situationB = makeSituation({
      id: "sB",
      signalIds: ["sigB1", "sigB2"],
      primarySignalId: "sigB2",
      emailIds: ["emailB"],
      calendarEventIds: ["eventB"],
    });
    const interventions = makeInterventions();
    const service = createAssistantEvaluationService({
      situations: makeSituationsService({
        getSituations: vi.fn().mockResolvedValue([situationA, situationB]),
      }),
      situationPrioritization: makePrioritization({
        prioritize: vi.fn().mockResolvedValue({
          ok: true,
          prioritizedSituations: [
            { situationId: "sA", priority: "high", reason: "r1", recommendedAction: "a1" },
            { situationId: "sB", priority: "low", reason: "r2", recommendedAction: "a2" },
          ],
        }),
      }),
      emails: makeEmails({
        listRecent: vi.fn().mockResolvedValue([
          makeEmail({ id: "emailA" }),
          makeEmail({ id: "emailB" }),
        ]),
      }),
      events: makeEvents({
        listUpcoming: vi.fn().mockResolvedValue([
          makeEvent({ id: "eventA" }),
          makeEvent({ id: "eventB" }),
        ]),
      }),
      signals: makeSignalsRepo({
        listOpen: vi.fn().mockResolvedValue([
          makeSignal({ id: "sigA1", sourceType: "email", sourceId: "emailA" }),
          makeSignal({ id: "sigA2", sourceType: "calendar_event", sourceId: "eventA" }),
          makeSignal({ id: "sigB1", sourceType: "email", sourceId: "emailB" }),
          makeSignal({ id: "sigB2", sourceType: "calendar_event", sourceId: "eventB" }),
        ]),
      }),
      interventions,
    });

    const result = await service.evaluate("user_1", NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.results).toHaveLength(2);
      expect(result.results.find((r) => r.situationId === "sA")?.outcome).toBe("created");
      expect(result.results.find((r) => r.situationId === "sB")?.outcome).toBe("skipped");
    }
    expect(interventions.create).toHaveBeenCalledTimes(1);
  });
});
