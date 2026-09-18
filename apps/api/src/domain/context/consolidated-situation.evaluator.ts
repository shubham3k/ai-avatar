import type { CrossSourceContext } from "./cross-source-context.types.js";
import type {
  ConsolidatedSituation,
  SituationSignalInput,
} from "./consolidated-situation.types.js";

type ConfidenceLevel = "high" | "medium" | null;

function extractConfidence(importanceHints: unknown): ConfidenceLevel {
  if (
    importanceHints &&
    typeof importanceHints === "object" &&
    "confidence" in importanceHints
  ) {
    const value = (importanceHints as { confidence?: unknown }).confidence;
    if (value === "high" || value === "medium") return value;
  }
  return null;
}

function priorityRank(confidence: ConfidenceLevel): number {
  if (confidence === "high") return 2;
  if (confidence === "medium") return 1;
  return 0;
}

/**
 * Deterministic primary-signal selection:
 *  1. Higher confidence/priority wins ("high" beats "medium" beats unknown).
 *  2. If tied, prefer the signal carrying a concrete dueAt (more time-bound —
 *     in practice this is the calendar signal, since email signals from
 *     Phase 2.3 don't set one). When both (or neither) have a dueAt, the
 *     earlier one wins.
 *  3. Final tie-break: earlier createdAt (first detected) wins.
 * No numeric/AI-style scoring — every step is a plain comparison.
 */
function selectPrimarySignal(
  a: SituationSignalInput,
  b: SituationSignalInput,
): SituationSignalInput {
  const rankA = priorityRank(extractConfidence(a.importanceHints));
  const rankB = priorityRank(extractConfidence(b.importanceHints));
  if (rankA !== rankB) return rankA > rankB ? a : b;

  if (a.dueAt && b.dueAt) {
    if (a.dueAt.getTime() !== b.dueAt.getTime()) {
      return a.dueAt.getTime() < b.dueAt.getTime() ? a : b;
    }
  } else if (a.dueAt && !b.dueAt) {
    return a;
  } else if (!a.dueAt && b.dueAt) {
    return b;
  }

  return a.createdAt.getTime() <= b.createdAt.getTime() ? a : b;
}

/**
 * Deterministic, pure grouping: given currently-open Signals and the
 * Phase 2.6A cross-source context, finds email+calendar signal pairs that
 * represent the same real-world situation. A pair consolidates only when
 * BOTH an email signal and a calendar signal already exist for the two
 * sides of an existing cross-source relationship — reuses Phase 2.6A's
 * correlation rules entirely rather than re-deriving evidence, so it
 * inherits the same conservatism (no generic-word or temporal-only
 * matches). Does not touch Prisma, does not create/mutate any Signal or
 * Intervention.
 */
export function evaluateConsolidatedSituations(
  signals: SituationSignalInput[],
  contexts: CrossSourceContext[],
): ConsolidatedSituation[] {
  const situations: ConsolidatedSituation[] = [];

  for (const context of contexts) {
    const emailSignal = signals.find(
      (signal) => signal.sourceType === "email" && signal.sourceId === context.emailId,
    );
    const calendarSignal = signals.find(
      (signal) =>
        signal.sourceType === "calendar_event" &&
        signal.sourceId === context.calendarEventId,
    );
    if (!emailSignal || !calendarSignal) continue;

    const primary = selectPrimarySignal(emailSignal, calendarSignal);

    situations.push({
      id: `${emailSignal.id}:${calendarSignal.id}`,
      signalIds: [emailSignal.id, calendarSignal.id],
      primarySignalId: primary.id,
      emailIds: [context.emailId],
      calendarEventIds: [context.calendarEventId],
      relationship: {
        type: context.relationship.type,
        strength: context.relationship.strength,
      },
    });
  }

  return situations;
}
