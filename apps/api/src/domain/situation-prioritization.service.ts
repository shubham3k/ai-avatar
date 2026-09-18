import { buildDailyContext } from "./daily-context/daily-context.builder.js";
import { CONTEXT_FETCH_LIMIT } from "./context/cross-source-context.rules.js";
import { buildDailyContextPrioritizationInput } from "./prioritization/prioritization-input.builder.js";
import {
  createPrioritizationService,
  type PrioritizationService,
} from "./prioritization/prioritization.service.js";
import type { PrioritizationOutcome } from "./prioritization/prioritization.types.js";
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
import { extractSignalConfidence } from "./signals/signal-confidence.js";
import { prisma } from "../lib/prisma.js";

/**
 * Orchestration only: loads the data the pure layers need (via existing,
 * unmodified repositories/services) and wires it through
 * buildDailyContext + buildDailyContextPrioritizationInput ->
 * PrioritizationService (Phase 3.2 — reuses Phase 3.1's DailyAssistantContext
 * builder on the same already-loaded data, no extra DB calls). Contains no
 * AI-calling or grouping logic of its own.
 */
export function createSituationPrioritizationService(dependencies?: {
  situations?: ConsolidatedSituationsService;
  emails?: EmailsRepository;
  events?: CalendarEventsRepository;
  signals?: SignalsRepository;
  goals?: GoalsRepository;
  prioritization?: PrioritizationService;
}) {
  const situationsService =
    dependencies?.situations ?? createConsolidatedSituationsService();
  const emails = dependencies?.emails ?? createEmailsRepository(prisma);
  const events = dependencies?.events ?? createCalendarEventsRepository(prisma);
  const signals = dependencies?.signals ?? createSignalsRepository(prisma);
  const goals = dependencies?.goals ?? createGoalsRepository(prisma);
  const prioritization = dependencies?.prioritization ?? createPrioritizationService();

  return {
    async prioritize(userId: string, now: Date = new Date()): Promise<PrioritizationOutcome> {
      const situations = await situationsService.getSituations(userId, now);
      if (situations.length === 0) {
        return { ok: true, prioritizedSituations: [] };
      }

      const [recentEmails, upcomingEvents, openSignals, activeGoals] = await Promise.all([
        emails.listRecent(userId, CONTEXT_FETCH_LIMIT),
        events.listUpcoming(userId, CONTEXT_FETCH_LIMIT, now),
        signals.listOpen(userId),
        goals.listActive(userId),
      ]);

      const emailsById = new Map(recentEmails.map((email) => [email.id, email]));
      const eventsById = new Map(upcomingEvents.map((event) => [event.id, event]));
      const signalsById = new Map(
        openSignals.map((signal) => [
          signal.id,
          {
            id: signal.id,
            sourceType: signal.sourceType,
            confidence: extractSignalConfidence(signal.importanceHints),
            dueAt: signal.dueAt,
          },
        ]),
      );

      // Phase 3.2: give the model the same bounded "what's going on right
      // now" picture as Phase 3.1's DailyAssistantContext, built from the
      // exact same already-loaded data above — no extra DB calls.
      const dailyContext = buildDailyContext(
        {
          recentEmails,
          upcomingEvents,
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

      const input = buildDailyContextPrioritizationInput(
        dailyContext,
        { emailsById, eventsById, signalsById },
        now,
        dailyContext.goals,
      );

      return prioritization.prioritize(input);
    },
  };
}

export type SituationPrioritizationService = ReturnType<
  typeof createSituationPrioritizationService
>;
