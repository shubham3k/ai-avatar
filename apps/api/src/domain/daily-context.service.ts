import { buildDailyContext } from "./daily-context/daily-context.builder.js";
import { DAILY_CONTEXT_FETCH_LIMIT } from "./daily-context/daily-context.rules.js";
import type { DailyAssistantContext } from "./daily-context/daily-context.types.js";
import {
  createConsolidatedSituationsService,
  type ConsolidatedSituationsService,
} from "./consolidated-situations.service.js";
import {
  createCalendarEventsRepository,
  type CalendarEventsRepository,
} from "../db/repositories/calendar-events.repository.js";
import {
  createEmailsRepository,
  type EmailsRepository,
} from "../db/repositories/emails.repository.js";
import {
  createSignalsRepository,
  type SignalsRepository,
} from "../db/repositories/interventions.repository.js";
import { createGoalsRepository, type GoalsRepository } from "../db/repositories/goals.repository.js";
import { prisma } from "../lib/prisma.js";

/**
 * Orchestration only: loads data via the existing, unmodified Phase 2
 * repositories/services (plus Phase 3.4's GoalsRepository) and hands it to
 * the pure buildDailyContext. Creates nothing — read-only, no
 * Signal/Intervention/Goal writes.
 */
export function createDailyContextService(dependencies?: {
  situations?: ConsolidatedSituationsService;
  emails?: EmailsRepository;
  events?: CalendarEventsRepository;
  signals?: SignalsRepository;
  goals?: GoalsRepository;
}) {
  const situationsService =
    dependencies?.situations ?? createConsolidatedSituationsService();
  const emails = dependencies?.emails ?? createEmailsRepository(prisma);
  const events = dependencies?.events ?? createCalendarEventsRepository(prisma);
  const signals = dependencies?.signals ?? createSignalsRepository(prisma);
  const goals = dependencies?.goals ?? createGoalsRepository(prisma);

  return {
    async getDailyContext(
      userId: string,
      now: Date = new Date(),
    ): Promise<DailyAssistantContext> {
      const [recentEmails, upcomingEvents, openSignals, situations, activeGoals] =
        await Promise.all([
          emails.listRecent(userId, DAILY_CONTEXT_FETCH_LIMIT),
          events.listUpcoming(userId, DAILY_CONTEXT_FETCH_LIMIT, now),
          signals.listOpen(userId),
          situationsService.getSituations(userId, now),
          goals.listActive(userId),
        ]);

      return buildDailyContext(
        {
          recentEmails: recentEmails.map((email) => ({
            id: email.id,
            fromEmail: email.fromEmail,
            subject: email.subject,
            snippet: email.snippet,
            receivedAt: email.receivedAt,
          })),
          upcomingEvents: upcomingEvents.map((event) => ({
            id: event.id,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            attendeeEmails: event.attendeeEmails,
          })),
          openSignals: openSignals.map((signal) => ({
            id: signal.id,
            sourceType: signal.sourceType,
            title: signal.title,
            dueAt: signal.dueAt,
            importanceHints: signal.importanceHints,
          })),
          situations,
          goals: activeGoals.map((goal) => ({
            id: goal.id,
            title: goal.title,
            description: goal.description,
          })),
        },
        now,
      );
    },
  };
}

export type DailyContextService = ReturnType<typeof createDailyContextService>;
