import {
  RECENT_EMAILS_WINDOW_HOURS,
  UPCOMING_EVENTS_WINDOW_HOURS,
} from "./daily-context.rules.js";
import type {
  DailyAssistantContext,
  DailyContextSourceData,
} from "./daily-context.types.js";
import { extractSignalConfidence } from "../signals/signal-confidence.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Pure transform: given already-loaded source records (no Prisma, no I/O),
 * builds the bounded DailyAssistantContext. Applies the "today" time windows
 * itself, on top of whatever the repositories already returned — the
 * repositories' own listRecent/listUpcoming are not date-windowed, so this
 * is where "previous 24h" / "next 24h" is actually enforced.
 */
export function buildDailyContext(
  data: DailyContextSourceData,
  now: Date = new Date(),
): DailyAssistantContext {
  const recentCutoff = new Date(now.getTime() - RECENT_EMAILS_WINDOW_HOURS * HOUR_MS);
  const upcomingCutoff = new Date(now.getTime() + UPCOMING_EVENTS_WINDOW_HOURS * HOUR_MS);

  const relevantEmails = data.recentEmails
    .filter((email) => email.receivedAt >= recentCutoff)
    .map((email) => ({
      id: email.id,
      fromEmail: email.fromEmail,
      subject: email.subject,
      snippet: email.snippet,
      receivedAt: email.receivedAt.toISOString(),
    }));

  const upcomingEvents = data.upcomingEvents
    .filter((event) => event.startAt <= upcomingCutoff)
    .map((event) => ({
      id: event.id,
      summary: event.title,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      attendeeEmails: event.attendeeEmails,
    }));

  const activeSignals = data.openSignals.map((signal) => ({
    id: signal.id,
    sourceType: signal.sourceType,
    title: signal.title,
    confidence: extractSignalConfidence(signal.importanceHints),
    dueAt: signal.dueAt ? signal.dueAt.toISOString() : null,
  }));

  const goals = data.goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    description: goal.description,
  }));

  return {
    currentTime: now.toISOString(),
    upcomingEvents,
    relevantEmails,
    activeSignals,
    consolidatedSituations: data.situations,
    goals,
  };
}
