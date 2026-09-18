import type {
  RelationshipStrength,
  RelationshipType,
} from "../context/cross-source-context.types.js";

export type PriorityLevel = "high" | "medium" | "low";

export interface PrioritizedSituationResult {
  situationId: string;
  priority: PriorityLevel;
  reason: string;
  recommendedAction: string;
}

export type PrioritizationFailureCode =
  | "not_configured"
  | "provider_error"
  | "malformed_output";

export type PrioritizationOutcome =
  | { ok: true; prioritizedSituations: PrioritizedSituationResult[] }
  | { ok: false; code: PrioritizationFailureCode; message: string };

/** Minimal, bounded email context — no body, only what's already stored. */
export interface PrioritizationEmailContext {
  fromEmail: string;
  subject: string | null;
  snippet: string | null;
  receivedAt: string;
}

/** Minimal, bounded calendar context — description is deliberately excluded. */
export interface PrioritizationCalendarContext {
  summary: string | null;
  startAt: string;
  endAt: string;
  attendeeEmails: string[];
}

export interface PrioritizationSignalContext {
  id: string;
  sourceType: string;
  confidence: "high" | "medium" | null;
  dueAt: string | null;
}

export interface PrioritizationSituationInput {
  situationId: string;
  relationship: { type: RelationshipType; strength: RelationshipStrength };
  email: PrioritizationEmailContext | null;
  calendarEvent: PrioritizationCalendarContext | null;
  signals: PrioritizationSignalContext[];
}

/** Bounded upcoming-event summary for the broader daily-context fields — same shape as DailyEventSummary. */
export interface PrioritizationUpcomingEvent {
  id: string;
  summary: string | null;
  startAt: string;
  endAt: string;
  attendeeEmails: string[];
}

/** Bounded recent-email summary for the broader daily-context fields — same shape as DailyEmailSummary. */
export interface PrioritizationRecentEmail {
  id: string;
  fromEmail: string;
  subject: string | null;
  snippet: string | null;
  receivedAt: string;
}

/** A user-defined goal/commitment (Phase 3.4) — title/description only, never a progress claim. */
export interface PrioritizationGoalContext {
  id: string;
  title: string;
  description: string | null;
}

export interface PrioritizationInput {
  situations: PrioritizationSituationInput[];
  generatedAt: string;
  /**
   * Phase 3.2 daily-context fields — optional and additive. When present,
   * they give the model the same broader "what's going on right now"
   * picture as Phase 3.1's DailyAssistantContext, on top of the
   * per-situation detail in `situations`. The model may only ever
   * *prioritize situations*; these fields are read-only extra context, not
   * something it can reference by ID or act on.
   */
  currentTime?: string;
  upcomingEvents?: PrioritizationUpcomingEvent[];
  relevantEmails?: PrioritizationRecentEmail[];
  /** Phase 3.4 — present once goals exist; empty/absent otherwise. */
  goals?: PrioritizationGoalContext[];
}
