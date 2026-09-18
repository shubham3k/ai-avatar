import type { ConsolidatedSituation } from "../context/consolidated-situation.types.js";
import type {
  PriorityLevel,
  PrioritizedSituationResult,
} from "../prioritization/prioritization.types.js";

export interface AssistantAction {
  type: "open_source";
  /** Always sourced from stored Email/CalendarEvent data — never from the AI response. */
  sourceUrl: string;
}

/** What the pure evaluator wants the orchestration layer to do next. */
export type InterventionIntent = "create" | "reuse" | "skip";

/** Final, reported outcome after the orchestration layer has acted on the intent. */
export type InterventionOutcome = "created" | "reused" | "skipped";

export interface AssistantDecisionInput {
  situation: ConsolidatedSituation;
  /** undefined when the AI did not return a result for this situation. */
  aiResult: PrioritizedSituationResult | undefined;
  /** Resolved by the orchestration layer by checking every signal in the situation. */
  existingInterventionId: string | null;
  primarySignalSourceType: "email" | "calendar_event" | null;
  primarySignalTitle: string | null;
  emailSourceUrl: string | null;
  calendarSourceUrl: string | null;
}

export interface AssistantDecision {
  situationId: string;
  primarySignalId: string;
  eligible: boolean;
  priority: PriorityLevel | null;
  intent: InterventionIntent;
  existingInterventionId: string | null;
  title: string | null;
  message: string | null;
  reason: string | null;
  action: AssistantAction | null;
}

export interface AssistantEvaluationResult {
  situationId: string;
  eligible: boolean;
  priority: PriorityLevel | null;
  interventionId: string | null;
  outcome: InterventionOutcome;
  message: string | null;
}

export type AssistantEvaluationFailureCode =
  | "not_configured"
  | "provider_error"
  | "malformed_output";

export type AssistantEvaluationOutcome =
  | { ok: true; results: AssistantEvaluationResult[] }
  | { ok: false; code: AssistantEvaluationFailureCode; message: string };
