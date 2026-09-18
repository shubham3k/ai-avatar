import type { RelationshipStrength } from "../context/cross-source-context.types.js";
import type { PriorityLevel } from "../prioritization/prioritization.types.js";

/** Desktop-card-friendly length; longer AI reasoning is truncated, never rewritten. */
export const MAX_MESSAGE_LENGTH = 140;

/**
 * Deterministic surfacing rule (application layer decides, not the LLM):
 *  - "high"   -> always eligible to surface.
 *  - "medium" -> eligible only when the underlying Phase 2.6A relationship
 *                is "strong" (attendee_match) — reuses an already-computed
 *                deterministic fact instead of inventing a new score.
 *  - "low"    -> never proactively surfaced (avoids notification spam).
 */
export function isEligibleToSurface(
  priority: PriorityLevel,
  relationshipStrength: RelationshipStrength,
): boolean {
  if (priority === "high") return true;
  if (priority === "medium") return relationshipStrength === "strong";
  return false;
}

/**
 * Builds the final desktop message from the AI's own `reason` — truncated to
 * a practical UI length, never rewritten via a second LLM call and never
 * displaying the full unbounded `recommendedAction` alongside it.
 */
export function buildAssistantMessage(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length <= MAX_MESSAGE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`;
}
