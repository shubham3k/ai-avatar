import type { ConsolidatedSituation } from "../context/consolidated-situation.types.js";

/** Minimal, bounded event fields — no description/location (mirrors prioritization's calendar context). */
export interface DailyEventSummary {
  id: string;
  summary: string | null;
  startAt: string;
  endAt: string;
  attendeeEmails: string[];
}

/** Minimal, bounded email fields — no body (mirrors prioritization's email context). */
export interface DailyEmailSummary {
  id: string;
  fromEmail: string;
  subject: string | null;
  snippet: string | null;
  receivedAt: string;
}

export interface DailySignalSummary {
  id: string;
  sourceType: string;
  title: string;
  confidence: "high" | "medium" | null;
  dueAt: string | null;
}

/** Phase 3.4 — a user-owned goal/commitment, title/description only. */
export interface DailyGoalSummary {
  id: string;
  title: string;
  description: string | null;
}

/**
 * A bounded snapshot of the user's current operating state, built entirely
 * from existing Phase 2 data (no new external calls, no new Gmail/Calendar
 * logic). Read-only — never creates a Signal or Intervention.
 */
export interface DailyAssistantContext {
  currentTime: string;
  upcomingEvents: DailyEventSummary[];
  relevantEmails: DailyEmailSummary[];
  activeSignals: DailySignalSummary[];
  consolidatedSituations: ConsolidatedSituation[];
  /** Phase 3.4 — the user's active goals/commitments; [] until any exist. */
  goals: DailyGoalSummary[];
}

/** Raw, already-loaded source records the pure builder needs — no Prisma types leak past this. */
export interface DailyContextSourceData {
  recentEmails: {
    id: string;
    fromEmail: string;
    subject: string | null;
    snippet: string | null;
    receivedAt: Date;
  }[];
  upcomingEvents: {
    id: string;
    title: string | null;
    startAt: Date;
    endAt: Date;
    attendeeEmails: string[];
  }[];
  openSignals: {
    id: string;
    sourceType: string;
    title: string;
    dueAt: Date | null;
    importanceHints: unknown;
  }[];
  situations: ConsolidatedSituation[];
  /** Already filtered to active goals by the caller (repository query). */
  goals: { id: string; title: string; description: string | null }[];
}
