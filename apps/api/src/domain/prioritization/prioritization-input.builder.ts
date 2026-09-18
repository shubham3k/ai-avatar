import type { ConsolidatedSituation } from "../context/consolidated-situation.types.js";
import type { DailyAssistantContext } from "../daily-context/daily-context.types.js";
import type {
  PrioritizationGoalContext,
  PrioritizationInput,
  PrioritizationSituationInput,
} from "./prioritization.types.js";

export interface PrioritizationEmailRecord {
  id: string;
  fromEmail: string;
  subject: string | null;
  snippet: string | null;
  receivedAt: Date;
}

export interface PrioritizationCalendarEventRecord {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  attendeeEmails: string[];
}

export interface PrioritizationSignalRecord {
  id: string;
  sourceType: string;
  confidence: "high" | "medium" | null;
  dueAt: Date | null;
}

export interface PrioritizationSourceData {
  emailsById: Map<string, PrioritizationEmailRecord>;
  eventsById: Map<string, PrioritizationCalendarEventRecord>;
  signalsById: Map<string, PrioritizationSignalRecord>;
}

/**
 * Pure transform: given already-loaded consolidated situations and their
 * related records, builds the bounded input sent to the AI. Deliberately
 * whitelists fields — never includes email bodies (never fetched anyway),
 * calendar descriptions, tokens, or any field not listed here. Does not
 * touch Prisma or any external API.
 */
export function buildPrioritizationInput(
  situations: ConsolidatedSituation[],
  data: PrioritizationSourceData,
  now: Date = new Date(),
): PrioritizationInput {
  const situationInputs: PrioritizationSituationInput[] = situations.map((situation) => {
    const email = data.emailsById.get(situation.emailIds[0] ?? "") ?? null;
    const event = data.eventsById.get(situation.calendarEventIds[0] ?? "") ?? null;

    const signals = situation.signalIds
      .map((id) => data.signalsById.get(id))
      .filter((signal): signal is PrioritizationSignalRecord => signal !== undefined)
      .map((signal) => ({
        id: signal.id,
        sourceType: signal.sourceType,
        confidence: signal.confidence,
        dueAt: signal.dueAt ? signal.dueAt.toISOString() : null,
      }));

    return {
      situationId: situation.id,
      relationship: situation.relationship,
      email: email
        ? {
            fromEmail: email.fromEmail,
            subject: email.subject,
            snippet: email.snippet,
            receivedAt: email.receivedAt.toISOString(),
          }
        : null,
      calendarEvent: event
        ? {
            summary: event.title,
            startAt: event.startAt.toISOString(),
            endAt: event.endAt.toISOString(),
            attendeeEmails: event.attendeeEmails,
          }
        : null,
      signals,
    };
  });

  return { situations: situationInputs, generatedAt: now.toISOString() };
}

/**
 * Extends buildPrioritizationInput (unchanged, reused as-is for the
 * per-situation detail) with the broader Phase 3.1 DailyAssistantContext —
 * so the model sees "what's going on right now" as well as each situation's
 * own bounded fields. Still pure: no Prisma, no I/O, no AI call. Goals are
 * passed through as-is (Phase 3.4); omitted entirely when there are none,
 * so existing (goal-less) callers/tests see no shape change.
 */
export function buildDailyContextPrioritizationInput(
  dailyContext: DailyAssistantContext,
  data: PrioritizationSourceData,
  now: Date = new Date(),
  goals: PrioritizationGoalContext[] = [],
): PrioritizationInput {
  const base = buildPrioritizationInput(dailyContext.consolidatedSituations, data, now);

  return {
    ...base,
    currentTime: dailyContext.currentTime,
    upcomingEvents: dailyContext.upcomingEvents,
    relevantEmails: dailyContext.relevantEmails,
    ...(goals.length > 0 ? { goals } : {}),
  };
}
