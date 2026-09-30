import { describe, expect, it, vi } from "vitest";
import type { Email } from "../db/repositories/emails.repository.js";
import type { Intervention, Signal } from "../db/repositories/interventions.repository.js";
import {
  clampDetectionLimit,
  createGmailSignalDetectionService,
  SIGNAL_DETECTION_DEFAULT_LIMIT,
  SIGNAL_DETECTION_MAX_LIMIT,
} from "./gmail-signal-detection.service.js";
import type { EmailsRepository } from "../db/repositories/emails.repository.js";
import type {
  InterventionsRepository,
  SignalsRepository,
} from "../db/repositories/interventions.repository.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "email_1",
    userId: "user_1",
    providerMessageId: "msg_1",
    threadId: "thread_1",
    fromEmail: "colleague@example.com",
    fromName: "Jamie",
    toEmails: ["demo@example.local"],
    subject: "Need your feedback",
    snippet: "Can you review this by tomorrow?",
    bodyText: null,
    receivedAt: new Date("2026-09-14T10:00:00.000Z"),
    isRead: false,
    labels: ["INBOX", "UNREAD"],
    sourceUrl: "https://mail.google.com/mail/u/0/#all/msg_1",
    rawUpdatedAt: null,
    sentAnalyzedAt: null,
    expectsReply: null,
    followUpCheckedAt: null,
    repliedAt: null,
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
    sourceType: "email",
    sourceId: "email_1",
    title: "Jamie needs your response",
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
    title: "Jamie needs your response",
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

function makeEmails(overrides: Partial<EmailsRepository> = {}): EmailsRepository {
  return {
    upsertEmail: vi.fn(),
    upsertMany: vi.fn(),
    findByProviderMessageId: vi.fn(),
    listRecent: vi.fn().mockResolvedValue([makeEmail()]),
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

describe("clampDetectionLimit", () => {
  it("defaults when no limit is requested", () => {
    expect(clampDetectionLimit(undefined)).toBe(SIGNAL_DETECTION_DEFAULT_LIMIT);
  });
  it("caps at the safe maximum", () => {
    expect(clampDetectionLimit(9999)).toBe(SIGNAL_DETECTION_MAX_LIMIT);
  });
  it("floors below 1", () => {
    expect(clampDetectionLimit(0)).toBe(1);
  });
});

describe("gmail signal detection service", () => {
  it("creates a signal and intervention for an actionable email", async () => {
    const emails = makeEmails();
    const signals = makeSignals();
    const interventions = makeInterventions();
    const service = createGmailSignalDetectionService({ emails, signals, interventions });

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
        sourceType: "email",
        sourceId: "email_1",
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

  it("does not create a signal for a non-actionable (excluded-sender) email", async () => {
    const emails = makeEmails({
      listRecent: vi.fn().mockResolvedValue([
        makeEmail({
          fromEmail: "newsletter@brand.com",
          subject: "Weekly digest",
          snippet: "Here's the news.",
        }),
      ]),
    });
    const signals = makeSignals();
    const interventions = makeInterventions();
    const service = createGmailSignalDetectionService({ emails, signals, interventions });

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

  it("does not create a duplicate signal when one already exists for the email", async () => {
    const existingSignal = makeSignal();
    const emails = makeEmails();
    const signals = makeSignals({ findUniqueKey: vi.fn().mockResolvedValue(existingSignal) });
    const interventions = makeInterventions();
    const service = createGmailSignalDetectionService({ emails, signals, interventions });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result.signalsCreated).toBe(0);
    expect(result.actionable).toBe(1);
    expect(signals.create).not.toHaveBeenCalled();
    // Still creates the intervention for the pre-existing signal, since none exists yet.
    expect(interventions.create).toHaveBeenCalledTimes(1);
  });

  it("does not create a duplicate intervention when one already exists for the signal", async () => {
    const existingSignal = makeSignal();
    const existingIntervention = makeIntervention();
    const emails = makeEmails();
    const signals = makeSignals({ findUniqueKey: vi.fn().mockResolvedValue(existingSignal) });
    const interventions = makeInterventions({
      findBySignalId: vi.fn().mockResolvedValue(existingIntervention),
    });
    const service = createGmailSignalDetectionService({ emails, signals, interventions });

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
    const emails = makeEmails();
    const service = createGmailSignalDetectionService({ emails, signals, interventions });

    const first = await service.detectAndCreateInterventions("user_1", 10, NOW);
    const second = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(first).toEqual({ analyzed: 1, actionable: 1, signalsCreated: 1, interventionsCreated: 1 });
    expect(second).toEqual({ analyzed: 1, actionable: 1, signalsCreated: 0, interventionsCreated: 0 });
  });

  it("references the correct persisted Email as the signal source", async () => {
    const email = makeEmail({ id: "email_specific" });
    const emails = makeEmails({ listRecent: vi.fn().mockResolvedValue([email]) });
    const signals = makeSignals();
    const interventions = makeInterventions();
    const service = createGmailSignalDetectionService({ emails, signals, interventions });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(signals.findUniqueKey).toHaveBeenCalledWith(
      "user_1",
      "user_action_required",
      "email",
      "email_specific",
    );
    expect(signals.create).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "email_specific", sourceType: "email" }),
    );
  });

  it("stores the matched rules and confidence in importanceHints", async () => {
    const emails = makeEmails({
      listRecent: vi
        .fn()
        .mockResolvedValue([
          makeEmail({ subject: "Quick question", snippet: "Can you take a look at this?" }),
        ]),
    });
    const signals = makeSignals();
    const service = createGmailSignalDetectionService({
      emails,
      signals,
      interventions: makeInterventions(),
    });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    const createCall = (signals.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.importanceHints.confidence).toBe("medium");
    expect(createCall.importanceHints.matchedRules).toContain("can_you");
  });

  it("produces a human-readable intervention message, not a generic one", async () => {
    const interventions = makeInterventions();
    const service = createGmailSignalDetectionService({
      emails: makeEmails(),
      signals: makeSignals(),
      interventions,
    });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    const createCall = (interventions.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.message).not.toMatch(/you have a new email/i);
    expect(createCall.message).toMatch(/Jamie/);
  });

  it("assigns high priority for high-confidence signals and medium for medium-confidence", async () => {
    const highEmail = makeEmail({
      id: "email_high",
      subject: "Quick question",
      snippet: "Please confirm this today.",
    });
    const mediumEmail = makeEmail({
      id: "email_medium",
      subject: "Quick question",
      snippet: "Can you take a look?",
    });
    const emails = makeEmails({
      listRecent: vi.fn().mockResolvedValue([highEmail, mediumEmail]),
    });
    const interventions = makeInterventions();
    const service = createGmailSignalDetectionService({
      emails,
      signals: makeSignals(),
      interventions,
    });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    const calls = (interventions.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0].priority).toBe("high");
    expect(calls[1]![0].priority).toBe("medium");
  });

  it("surfaces a plain informational email generically — 'New email from X', not 'needs your response'", async () => {
    const genericEmail = makeEmail({
      subject: "Team update",
      snippet: "Here's what happened this week.",
    });
    const emails = makeEmails({ listRecent: vi.fn().mockResolvedValue([genericEmail]) });
    const interventions = makeInterventions();
    const service = createGmailSignalDetectionService({
      emails,
      signals: makeSignals(),
      interventions,
    });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({ analyzed: 1, actionable: 1, signalsCreated: 1, interventionsCreated: 1 });
    const createCall = (interventions.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.priority).toBe("medium");
    expect(createCall.title).toBe("New email from Jamie");
  });

  it("respects the analyzed count even when no emails are actionable", async () => {
    const emails = makeEmails({
      listRecent: vi.fn().mockResolvedValue([
        makeEmail({ id: "a", isRead: true }),
        makeEmail({ id: "b", fromEmail: "newsletter@brand.com", subject: "FYI", snippet: "no request here" }),
      ]),
    });
    const service = createGmailSignalDetectionService({
      emails,
      signals: makeSignals(),
      interventions: makeInterventions(),
    });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({ analyzed: 2, actionable: 0, signalsCreated: 0, interventionsCreated: 0 });
  });

  it("handles zero stored emails without error", async () => {
    const emails = makeEmails({ listRecent: vi.fn().mockResolvedValue([]) });
    const service = createGmailSignalDetectionService({
      emails,
      signals: makeSignals(),
      interventions: makeInterventions(),
    });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({ analyzed: 0, actionable: 0, signalsCreated: 0, interventionsCreated: 0 });
  });

  it("passes the clamped limit through to listRecent", async () => {
    const emails = makeEmails();
    const service = createGmailSignalDetectionService({
      emails,
      signals: makeSignals(),
      interventions: makeInterventions(),
    });

    await service.detectAndCreateInterventions("user_1", 9999, NOW);

    expect(emails.listRecent).toHaveBeenCalledWith("user_1", SIGNAL_DETECTION_MAX_LIMIT);
  });
});
