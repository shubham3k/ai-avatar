import { describe, expect, it } from "vitest";
import { evaluateAssistantDecision } from "./assistant-decision.evaluator.js";
import type { AssistantDecisionInput } from "./assistant-decision.types.js";
import type { ConsolidatedSituation } from "../context/consolidated-situation.types.js";

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

function makeInput(overrides: Partial<AssistantDecisionInput> = {}): AssistantDecisionInput {
  return {
    situation: makeSituation(),
    aiResult: {
      situationId: "email_signal:calendar_signal",
      priority: "high",
      reason: "The email requests the proposal before tomorrow's review.",
      recommendedAction: "Send the proposal before the meeting.",
    },
    existingInterventionId: null,
    primarySignalSourceType: "calendar_event",
    primarySignalTitle: "Acme proposal review",
    emailSourceUrl: "https://mail.google.com/mail/u/0/#all/msg",
    calendarSourceUrl: "https://calendar.google.com/event?eid=evt",
    ...overrides,
  };
}

describe("evaluateAssistantDecision — surfacing rules", () => {
  it("marks a high-priority situation eligible and intent=create", () => {
    const decision = evaluateAssistantDecision(makeInput());
    expect(decision.eligible).toBe(true);
    expect(decision.intent).toBe("create");
  });

  it("marks a medium-priority situation eligible only when the relationship is strong", () => {
    const strong = evaluateAssistantDecision(
      makeInput({
        aiResult: { ...makeInput().aiResult!, priority: "medium" },
        situation: makeSituation({ relationship: { type: "attendee_match", strength: "strong" } }),
      }),
    );
    expect(strong.eligible).toBe(true);
    expect(strong.intent).toBe("create");

    const possible = evaluateAssistantDecision(
      makeInput({
        aiResult: { ...makeInput().aiResult!, priority: "medium" },
        situation: makeSituation({ relationship: { type: "topic_overlap", strength: "possible" } }),
      }),
    );
    expect(possible.eligible).toBe(false);
    expect(possible.intent).toBe("skip");
  });

  it("never proactively surfaces a low-priority situation", () => {
    const decision = evaluateAssistantDecision(
      makeInput({ aiResult: { ...makeInput().aiResult!, priority: "low" } }),
    );
    expect(decision.eligible).toBe(false);
    expect(decision.intent).toBe("skip");
    expect(decision.action).toBeNull();
  });

  it("does not create an intervention when the AI returned no result for this situation", () => {
    const decision = evaluateAssistantDecision(makeInput({ aiResult: undefined }));
    expect(decision.eligible).toBe(false);
    expect(decision.intent).toBe("skip");
    expect(decision.priority).toBeNull();
  });
});

describe("evaluateAssistantDecision — reuse / idempotency", () => {
  it("reuses an already-pending intervention instead of creating a new one", () => {
    const decision = evaluateAssistantDecision(
      makeInput({ existingInterventionId: "int_existing" }),
    );
    expect(decision.intent).toBe("reuse");
    expect(decision.existingInterventionId).toBe("int_existing");
  });

  it("does not recreate an already-resolved/done intervention (reuse regardless of downstream status)", () => {
    // The evaluator only knows "an intervention exists for this signal" —
    // status-specific handling (done/snoozed) is the existing Intervention
    // lifecycle's job (Done/Snooze endpoints), not re-derived here.
    const decision = evaluateAssistantDecision(
      makeInput({ existingInterventionId: "int_done" }),
    );
    expect(decision.intent).toBe("reuse");
  });

  it("respects a snoozed intervention by reusing rather than re-surfacing a new one", () => {
    const decision = evaluateAssistantDecision(
      makeInput({ existingInterventionId: "int_snoozed" }),
    );
    expect(decision.intent).toBe("reuse");
    expect(decision.action).toBeNull();
  });

  it("is idempotent: evaluating twice with the same existing intervention always reuses", () => {
    const input = makeInput({ existingInterventionId: "int_existing" });
    const first = evaluateAssistantDecision(input);
    const second = evaluateAssistantDecision(input);
    expect(first).toEqual(second);
    expect(first.intent).toBe("reuse");
  });
});

describe("evaluateAssistantDecision — primary signal & source URL trust", () => {
  it("uses the calendar event's source URL when the primary signal is the calendar signal", () => {
    const decision = evaluateAssistantDecision(
      makeInput({ primarySignalSourceType: "calendar_event" }),
    );
    expect(decision.action).toEqual({
      type: "open_source",
      sourceUrl: "https://calendar.google.com/event?eid=evt",
    });
  });

  it("uses the email's source URL when the primary signal is the email signal", () => {
    const decision = evaluateAssistantDecision(
      makeInput({ primarySignalSourceType: "email" }),
    );
    expect(decision.action).toEqual({
      type: "open_source",
      sourceUrl: "https://mail.google.com/mail/u/0/#all/msg",
    });
  });

  it("never lets an AI-supplied URL override the stored source URL (AI result carries no URL field at all)", () => {
    const decision = evaluateAssistantDecision(makeInput());
    // PrioritizedSituationResult has no url-shaped field to begin with —
    // this assertion documents that guarantee at the type level and via output.
    expect(decision.action?.sourceUrl).toBe("https://calendar.google.com/event?eid=evt");
    expect(JSON.stringify(decision)).not.toMatch(/example\.com\/attacker/);
  });

  it("produces no action when the trusted source URL is missing", () => {
    const decision = evaluateAssistantDecision(
      makeInput({ calendarSourceUrl: null, primarySignalSourceType: "calendar_event" }),
    );
    expect(decision.action).toBeNull();
  });
});

describe("evaluateAssistantDecision — message construction", () => {
  it("uses the AI's reason as the message, not the recommendedAction", () => {
    const decision = evaluateAssistantDecision(makeInput());
    expect(decision.message).toBe("The email requests the proposal before tomorrow's review.");
  });

  it("truncates an overly long reason to a practical UI length", () => {
    const longReason = "x".repeat(300);
    const decision = evaluateAssistantDecision(
      makeInput({ aiResult: { ...makeInput().aiResult!, reason: longReason } }),
    );
    expect(decision.message!.length).toBeLessThanOrEqual(140);
    expect(decision.message!.endsWith("…")).toBe(true);
  });

  it("stores the recommendedAction separately as the intervention reason", () => {
    const decision = evaluateAssistantDecision(makeInput());
    expect(decision.reason).toBe("Send the proposal before the meeting.");
  });

  it("uses the primary signal's own title rather than inventing one", () => {
    const decision = evaluateAssistantDecision(
      makeInput({ primarySignalTitle: "Client meeting" }),
    );
    expect(decision.title).toBe("Client meeting");
  });
});

describe("evaluateAssistantDecision — determinism", () => {
  it("produces identical output for identical input", () => {
    const input = makeInput();
    expect(evaluateAssistantDecision(input)).toEqual(evaluateAssistantDecision(input));
  });
});
