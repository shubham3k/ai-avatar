import { describe, expect, it, vi } from "vitest";
import type { Signal } from "../db/repositories/interventions.repository.js";
import { createConsolidatedSituationsService } from "./consolidated-situations.service.js";
import type { CrossSourceContextService } from "./cross-source-context.service.js";
import type { SignalsRepository } from "../db/repositories/interventions.repository.js";
import type { CrossSourceContext } from "./context/cross-source-context.types.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "signal_1",
    userId: "user_1",
    type: "user_action_required",
    sourceType: "email",
    sourceId: "email_1",
    title: "Needs your response",
    summary: "reason",
    dueAt: null,
    importanceHints: { confidence: "medium" },
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeContext(overrides: Partial<CrossSourceContext> = {}): CrossSourceContext {
  return {
    emailId: "email_1",
    calendarEventId: "event_1",
    relationship: { type: "attendee_match", strength: "strong", reason: "x" },
    temporalContext: {
      emailReceivedAt: NOW.toISOString(),
      eventStartAt: "2026-09-15T10:00:00.000Z",
      hoursBetween: 22,
    },
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
      }),
    ]),
    create: vi.fn(),
    ...overrides,
  };
}

function makeContextService(
  overrides: Partial<CrossSourceContextService> = {},
): CrossSourceContextService {
  return {
    getContext: vi.fn().mockResolvedValue([makeContext()]),
    ...overrides,
  };
}

describe("consolidated situations service", () => {
  it("loads open signals and cross-source context, then evaluates situations", async () => {
    const signalsRepo = makeSignalsRepo();
    const contextService = makeContextService();
    const service = createConsolidatedSituationsService({
      signals: signalsRepo,
      context: contextService,
    });

    const situations = await service.getSituations("user_1", NOW);

    expect(signalsRepo.listOpen).toHaveBeenCalledWith("user_1");
    expect(contextService.getContext).toHaveBeenCalledWith("user_1", NOW);
    expect(situations).toHaveLength(1);
    expect(situations[0]?.signalIds.sort()).toEqual(
      ["calendar_signal", "email_signal"].sort(),
    );
  });

  it("returns an empty array when there are no open signals", async () => {
    const signalsRepo = makeSignalsRepo({ listOpen: vi.fn().mockResolvedValue([]) });
    const service = createConsolidatedSituationsService({
      signals: signalsRepo,
      context: makeContextService(),
    });

    const situations = await service.getSituations("user_1", NOW);

    expect(situations).toEqual([]);
  });

  it("returns an empty array when there is no cross-source context", async () => {
    const contextService = makeContextService({ getContext: vi.fn().mockResolvedValue([]) });
    const service = createConsolidatedSituationsService({
      signals: makeSignalsRepo(),
      context: contextService,
    });

    const situations = await service.getSituations("user_1", NOW);

    expect(situations).toEqual([]);
  });

  it("returns an empty array when both are empty", async () => {
    const service = createConsolidatedSituationsService({
      signals: makeSignalsRepo({ listOpen: vi.fn().mockResolvedValue([]) }),
      context: makeContextService({ getContext: vi.fn().mockResolvedValue([]) }),
    });

    expect(await service.getSituations("user_1", NOW)).toEqual([]);
  });

  it("passes through Signal.dueAt/importanceHints correctly for primary selection", async () => {
    const signalsRepo = makeSignalsRepo();
    const service = createConsolidatedSituationsService({
      signals: signalsRepo,
      context: makeContextService(),
    });

    const situations = await service.getSituations("user_1", NOW);

    // The calendar signal has a concrete dueAt; confidence is tied at "medium" for both,
    // so the calendar signal should win as primary per the documented tie-break rule.
    expect(situations[0]?.primarySignalId).toBe("calendar_signal");
  });
});
