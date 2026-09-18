import { describe, expect, it } from "vitest";
import { evaluateConsolidatedSituations } from "./consolidated-situation.evaluator.js";
import type { SituationSignalInput } from "./consolidated-situation.types.js";
import type { CrossSourceContext } from "./cross-source-context.types.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeEmailSignal(overrides: Partial<SituationSignalInput> = {}): SituationSignalInput {
  return {
    id: "email_signal_1",
    sourceType: "email",
    sourceId: "email_1",
    dueAt: null,
    createdAt: NOW,
    importanceHints: { confidence: "medium" },
    ...overrides,
  };
}

function makeCalendarSignal(
  overrides: Partial<SituationSignalInput> = {},
): SituationSignalInput {
  return {
    id: "calendar_signal_1",
    sourceType: "calendar_event",
    sourceId: "event_1",
    dueAt: new Date("2026-09-15T10:00:00.000Z"),
    createdAt: NOW,
    importanceHints: { confidence: "high" },
    ...overrides,
  };
}

function makeContext(overrides: Partial<CrossSourceContext> = {}): CrossSourceContext {
  return {
    emailId: "email_1",
    calendarEventId: "event_1",
    relationship: {
      type: "attendee_match",
      strength: "strong",
      reason: "Email sender is an attendee of the upcoming calendar event.",
    },
    temporalContext: {
      emailReceivedAt: NOW.toISOString(),
      eventStartAt: "2026-09-15T10:00:00.000Z",
      hoursBetween: 22,
    },
    ...overrides,
  };
}

describe("evaluateConsolidatedSituations — grouping", () => {
  it("consolidates a related email signal and calendar signal into one situation", () => {
    const situations = evaluateConsolidatedSituations(
      [makeEmailSignal(), makeCalendarSignal()],
      [makeContext()],
    );

    expect(situations).toHaveLength(1);
    expect(situations[0]?.signalIds.sort()).toEqual(
      ["calendar_signal_1", "email_signal_1"].sort(),
    );
    expect(situations[0]?.emailIds).toEqual(["email_1"]);
    expect(situations[0]?.calendarEventIds).toEqual(["event_1"]);
  });

  it("keeps unrelated signals independent when no cross-source context links them", () => {
    const situations = evaluateConsolidatedSituations(
      [
        makeEmailSignal({ id: "e1", sourceId: "email_unrelated" }),
        makeCalendarSignal({ id: "c1", sourceId: "event_unrelated" }),
      ],
      [], // no correlation found by Phase 2.6A
    );

    expect(situations).toHaveLength(0);
  });

  it("does not consolidate when only one side has an actual open signal", () => {
    // Context exists, but no calendar signal was ever created for that event.
    const situations = evaluateConsolidatedSituations(
      [makeEmailSignal()],
      [makeContext()],
    );
    expect(situations).toHaveLength(0);
  });

  it("consolidates on a strong (attendee_match) relationship", () => {
    const situations = evaluateConsolidatedSituations(
      [makeEmailSignal(), makeCalendarSignal()],
      [makeContext({ relationship: { type: "attendee_match", strength: "strong", reason: "x" } })],
    );
    expect(situations).toHaveLength(1);
    expect(situations[0]?.relationship).toEqual({ type: "attendee_match", strength: "strong" });
  });

  it("consolidates on a possible (topic_overlap) relationship, per the conservative-but-inclusive rule", () => {
    const situations = evaluateConsolidatedSituations(
      [makeEmailSignal(), makeCalendarSignal()],
      [
        makeContext({
          relationship: {
            type: "topic_overlap",
            strength: "possible",
            reason: "shared terms",
            matchedTerms: ["proposal"],
          },
        }),
      ],
    );
    expect(situations).toHaveLength(1);
    expect(situations[0]?.relationship).toEqual({ type: "topic_overlap", strength: "possible" });
  });

  it("produces no situation when there is no cross-source context at all (temporal proximity alone never reaches this layer)", () => {
    // Phase 2.6A already refuses to produce a context from time proximity alone,
    // so an empty contexts array is exactly what that looks like here.
    const situations = evaluateConsolidatedSituations(
      [makeEmailSignal(), makeCalendarSignal()],
      [],
    );
    expect(situations).toHaveLength(0);
  });

  it("handles an empty signal set without error", () => {
    expect(evaluateConsolidatedSituations([], [makeContext()])).toEqual([]);
  });

  it("handles an empty context set without error", () => {
    expect(evaluateConsolidatedSituations([makeEmailSignal(), makeCalendarSignal()], [])).toEqual(
      [],
    );
  });

  it("is deterministic: repeated evaluation of identical input produces identical output", () => {
    const signals = [makeEmailSignal(), makeCalendarSignal()];
    const contexts = [makeContext()];
    expect(evaluateConsolidatedSituations(signals, contexts)).toEqual(
      evaluateConsolidatedSituations(signals, contexts),
    );
  });

  it("produces multiple independent situations for multiple unrelated pairs", () => {
    const signals = [
      makeEmailSignal({ id: "e1", sourceId: "email_1" }),
      makeCalendarSignal({ id: "c1", sourceId: "event_1" }),
      makeEmailSignal({ id: "e2", sourceId: "email_2" }),
      makeCalendarSignal({ id: "c2", sourceId: "event_2" }),
    ];
    const contexts = [
      makeContext({ emailId: "email_1", calendarEventId: "event_1" }),
      makeContext({ emailId: "email_2", calendarEventId: "event_2" }),
    ];

    const situations = evaluateConsolidatedSituations(signals, contexts);

    expect(situations).toHaveLength(2);
    const ids = situations.map((s) => s.id).sort();
    expect(ids).toEqual(["e1:c1", "e2:c2"].sort());
  });

  it("handles multiple emails correlating with the same event as separate situations", () => {
    const signals = [
      makeEmailSignal({ id: "e1", sourceId: "email_1" }),
      makeEmailSignal({ id: "e2", sourceId: "email_2" }),
      makeCalendarSignal({ id: "c1", sourceId: "event_1" }),
    ];
    const contexts = [
      makeContext({ emailId: "email_1", calendarEventId: "event_1" }),
      makeContext({ emailId: "email_2", calendarEventId: "event_1" }),
    ];

    const situations = evaluateConsolidatedSituations(signals, contexts);

    expect(situations).toHaveLength(2);
    expect(situations.every((s) => s.signalIds.includes("c1"))).toBe(true);
  });
});

describe("evaluateConsolidatedSituations — primary signal selection", () => {
  it("prefers the high-confidence signal over the medium-confidence one", () => {
    const highEmail = makeEmailSignal({ id: "e_high", importanceHints: { confidence: "high" } });
    const mediumCalendar = makeCalendarSignal({
      id: "c_medium",
      importanceHints: { confidence: "medium" },
      dueAt: null,
    });
    const situations = evaluateConsolidatedSituations([highEmail, mediumCalendar], [makeContext()]);

    expect(situations[0]?.primarySignalId).toBe("e_high");
  });

  it("prefers the signal with a concrete dueAt when confidence is tied", () => {
    const email = makeEmailSignal({ importanceHints: { confidence: "high" }, dueAt: null });
    const calendar = makeCalendarSignal({
      importanceHints: { confidence: "high" },
      dueAt: new Date("2026-09-15T10:00:00.000Z"),
    });
    const situations = evaluateConsolidatedSituations([email, calendar], [makeContext()]);

    expect(situations[0]?.primarySignalId).toBe(calendar.id);
  });

  it("breaks a full tie (same confidence, same dueAt-ness) using earlier createdAt deterministically", () => {
    const earlier = makeEmailSignal({
      id: "earlier",
      importanceHints: { confidence: "medium" },
      dueAt: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const later = makeCalendarSignal({
      id: "later",
      importanceHints: { confidence: "medium" },
      dueAt: null,
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
    });
    const situations = evaluateConsolidatedSituations([earlier, later], [makeContext()]);

    expect(situations[0]?.primarySignalId).toBe("earlier");
  });

  it("treats missing/unrecognized importanceHints as the lowest confidence tier without throwing", () => {
    const noHints = makeEmailSignal({ id: "no_hints", importanceHints: null });
    const withHints = makeCalendarSignal({ id: "with_hints", importanceHints: { confidence: "medium" } });
    const situations = evaluateConsolidatedSituations([noHints, withHints], [makeContext()]);

    expect(situations[0]?.primarySignalId).toBe("with_hints");
  });

  it("handles malformed importanceHints gracefully", () => {
    const malformed = makeEmailSignal({ id: "malformed", importanceHints: "not-an-object" });
    const normal = makeCalendarSignal({ id: "normal", importanceHints: { confidence: "high" } });
    expect(() => evaluateConsolidatedSituations([malformed, normal], [makeContext()])).not.toThrow();
  });
});
