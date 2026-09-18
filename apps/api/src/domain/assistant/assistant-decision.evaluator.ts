import { buildAssistantMessage, isEligibleToSurface } from "./assistant-decision.rules.js";
import type { AssistantDecision, AssistantDecisionInput } from "./assistant-decision.types.js";

/**
 * Pure, deterministic per-situation decision. No Prisma, no AI provider, no I/O.
 *
 * Reuse-before-create: if an intervention already exists for ANY signal in
 * this situation (from this endpoint's own prior run, or from the
 * independent Phase 2.3/2.5 detect-signals endpoints), the situation is
 * considered already handled — the AI's priority for this call does not
 * override or duplicate an existing pending/snoozed/resolved intervention.
 * This mirrors the existing find-or-create lifecycle used everywhere else
 * in the codebase rather than introducing a parallel state system.
 */
export function evaluateAssistantDecision(input: AssistantDecisionInput): AssistantDecision {
  const base = {
    situationId: input.situation.id,
    primarySignalId: input.situation.primarySignalId,
  };

  if (input.existingInterventionId) {
    return {
      ...base,
      eligible: true,
      priority: input.aiResult?.priority ?? null,
      intent: "reuse",
      existingInterventionId: input.existingInterventionId,
      title: null,
      message: null,
      reason: null,
      action: null,
    };
  }

  if (!input.aiResult) {
    return {
      ...base,
      eligible: false,
      priority: null,
      intent: "skip",
      existingInterventionId: null,
      title: null,
      message: null,
      reason: null,
      action: null,
    };
  }

  const eligible = isEligibleToSurface(
    input.aiResult.priority,
    input.situation.relationship.strength,
  );
  if (!eligible) {
    return {
      ...base,
      eligible: false,
      priority: input.aiResult.priority,
      intent: "skip",
      existingInterventionId: null,
      title: null,
      message: null,
      reason: null,
      action: null,
    };
  }

  // Trust boundary: the action URL always comes from stored source data,
  // keyed off the deterministically-selected primary signal — never from
  // anything the AI returned.
  const sourceUrl =
    input.primarySignalSourceType === "calendar_event"
      ? input.calendarSourceUrl
      : input.primarySignalSourceType === "email"
        ? input.emailSourceUrl
        : null;

  return {
    ...base,
    eligible: true,
    priority: input.aiResult.priority,
    intent: "create",
    existingInterventionId: null,
    title: input.primarySignalTitle,
    message: buildAssistantMessage(input.aiResult.reason),
    reason: input.aiResult.recommendedAction,
    action: sourceUrl ? { type: "open_source", sourceUrl } : null,
  };
}
