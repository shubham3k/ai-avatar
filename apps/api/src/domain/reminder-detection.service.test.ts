import { describe, expect, it, vi } from "vitest";
import type { Reminder } from "@prisma/client";
import type { Intervention, Signal } from "../db/repositories/interventions.repository.js";
import {
  clampReminderDetectionLimit,
  createReminderDetectionService,
  REMINDER_DETECTION_DEFAULT_LIMIT,
  REMINDER_DETECTION_MAX_LIMIT,
} from "./reminder-detection.service.js";
import type { RemindersRepository } from "../db/repositories/reminders.repository.js";
import type {
  InterventionsRepository,
  SignalsRepository,
} from "../db/repositories/interventions.repository.js";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "reminder_1",
    userId: "user_1",
    text: "Call the vendor about pricing",
    dueAt: new Date("2026-09-24T11:00:00.000Z"),
    remindAt: null,
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
    sourceType: "reminder",
    sourceId: "reminder_1",
    title: "Call the vendor about pricing",
    summary: "Call the vendor about pricing",
    dueAt: NOW,
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
    priority: "medium",
    title: "Call the vendor about pricing",
    message: "Call the vendor about pricing",
    reason: "Call the vendor about pricing",
    actionType: "none",
    actionPayload: null,
    snoozedUntil: null,
    createdAt: new Date(),
    resolvedAt: null,
    lastDeliveredAt: null,
    ...overrides,
  };
}

function makeReminders(overrides: Partial<RemindersRepository> = {}): RemindersRepository {
  return {
    create: vi.fn(),
    listAll: vi.fn(),
    listDue: vi.fn().mockResolvedValue([makeReminder()]),
    findById: vi.fn(),
    delete: vi.fn(),
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

describe("clampReminderDetectionLimit", () => {
  it("defaults when no limit is requested", () => {
    expect(clampReminderDetectionLimit(undefined)).toBe(REMINDER_DETECTION_DEFAULT_LIMIT);
  });
  it("caps at the safe maximum", () => {
    expect(clampReminderDetectionLimit(9999)).toBe(REMINDER_DETECTION_MAX_LIMIT);
  });
  it("floors below 1", () => {
    expect(clampReminderDetectionLimit(0)).toBe(1);
  });
});

describe("reminder detection service", () => {
  it("says how far away the event is for a heads-up reminder that fires before its dueAt", async () => {
    const interventions = makeInterventions();
    const service = createReminderDetectionService({
      reminders: makeReminders({
        listDue: vi.fn().mockResolvedValue([
          makeReminder({
            text: "Meeting",
            dueAt: new Date(NOW.getTime() + 10 * 60_000),
            remindAt: NOW,
          }),
        ]),
      }),
      signals: makeSignals(),
      interventions,
    });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(interventions.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Meeting", message: "Meeting — in 10 minutes." }),
    );
  });

  it("uses the plain text for a direct ping that fires at its dueAt", async () => {
    const interventions = makeInterventions();
    const service = createReminderDetectionService({
      reminders: makeReminders(),
      signals: makeSignals(),
      interventions,
    });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(interventions.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Call the vendor about pricing" }),
    );
  });

  it("creates a signal and intervention for a due reminder, always at medium priority", async () => {
    const reminders = makeReminders();
    const signals = makeSignals();
    const interventions = makeInterventions();
    const service = createReminderDetectionService({ reminders, signals, interventions });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({ analyzed: 1, interventionsCreated: 1 });
    expect(signals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        type: "user_action_required",
        sourceType: "reminder",
        sourceId: "reminder_1",
      }),
    );
    expect(interventions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        signalId: "signal_1",
        priority: "medium",
        actionType: "none",
        message: "Call the vendor about pricing",
      }),
    );
  });

  it("truncates a long reminder's text for the title but keeps the full text in the message", async () => {
    const longText = "x".repeat(80);
    const reminders = makeReminders({
      listDue: vi.fn().mockResolvedValue([makeReminder({ text: longText })]),
    });
    const signals = makeSignals();
    const interventions = makeInterventions();
    const service = createReminderDetectionService({ reminders, signals, interventions });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    const signalCall = (signals.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(signalCall.title.length).toBeLessThan(longText.length);
    expect(signalCall.title.endsWith("…")).toBe(true);

    const interventionCall = (interventions.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(interventionCall.message).toBe(longText);
  });

  it("only queries reminders actually due (listDue is trusted, not re-filtered)", async () => {
    const reminders = makeReminders();
    const service = createReminderDetectionService({
      reminders,
      signals: makeSignals(),
      interventions: makeInterventions(),
    });

    await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(reminders.listDue).toHaveBeenCalledWith("user_1", NOW, 10);
  });

  it("does not create a duplicate signal when one already exists for the reminder", async () => {
    const existingSignal = makeSignal();
    const reminders = makeReminders();
    const signals = makeSignals({ findUniqueKey: vi.fn().mockResolvedValue(existingSignal) });
    const interventions = makeInterventions();
    const service = createReminderDetectionService({ reminders, signals, interventions });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result.interventionsCreated).toBe(1);
    expect(signals.create).not.toHaveBeenCalled();
    expect(interventions.create).toHaveBeenCalledTimes(1);
  });

  it("does not create a duplicate intervention when one already exists for the signal", async () => {
    const existingSignal = makeSignal();
    const existingIntervention = makeIntervention();
    const reminders = makeReminders();
    const signals = makeSignals({ findUniqueKey: vi.fn().mockResolvedValue(existingSignal) });
    const interventions = makeInterventions({
      findBySignalId: vi.fn().mockResolvedValue(existingIntervention),
    });
    const service = createReminderDetectionService({ reminders, signals, interventions });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({ analyzed: 1, interventionsCreated: 0 });
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
    const reminders = makeReminders();
    const service = createReminderDetectionService({ reminders, signals, interventions });

    const first = await service.detectAndCreateInterventions("user_1", 10, NOW);
    const second = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(first).toEqual({ analyzed: 1, interventionsCreated: 1 });
    expect(second).toEqual({ analyzed: 1, interventionsCreated: 0 });
  });

  it("handles zero due reminders without error", async () => {
    const reminders = makeReminders({ listDue: vi.fn().mockResolvedValue([]) });
    const service = createReminderDetectionService({
      reminders,
      signals: makeSignals(),
      interventions: makeInterventions(),
    });

    const result = await service.detectAndCreateInterventions("user_1", 10, NOW);

    expect(result).toEqual({ analyzed: 0, interventionsCreated: 0 });
  });
});
