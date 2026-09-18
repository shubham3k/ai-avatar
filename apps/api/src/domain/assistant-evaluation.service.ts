import { evaluateAssistantDecision } from "./assistant/assistant-decision.evaluator.js";
import type { AssistantEvaluationOutcome } from "./assistant/assistant-decision.types.js";
import { CONTEXT_FETCH_LIMIT } from "./context/cross-source-context.rules.js";
import {
  createConsolidatedSituationsService,
  type ConsolidatedSituationsService,
} from "./consolidated-situations.service.js";
import {
  createSituationPrioritizationService,
  type SituationPrioritizationService,
} from "./situation-prioritization.service.js";
import {
  createCalendarEventsRepository,
  type CalendarEventsRepository,
} from "../db/repositories/calendar-events.repository.js";
import {
  createEmailsRepository,
  type EmailsRepository,
} from "../db/repositories/emails.repository.js";
import {
  createInterventionsRepository,
  createSignalsRepository,
  type InterventionsRepository,
  type SignalsRepository,
} from "../db/repositories/interventions.repository.js";
import { prisma } from "../lib/prisma.js";

const AVAILABLE_ACTIONS = ["DONE", "REMIND_LATER"];

/**
 * Application-controlled orchestration: AI prioritization is advisory only.
 * This layer decides whether an intervention is allowed, creates/reuses it
 * through the existing InterventionsRepository, and enforces deduplication —
 * the LLM never touches the database directly.
 */
export function createAssistantEvaluationService(dependencies?: {
  situations?: ConsolidatedSituationsService;
  situationPrioritization?: SituationPrioritizationService;
  emails?: EmailsRepository;
  events?: CalendarEventsRepository;
  signals?: SignalsRepository;
  interventions?: InterventionsRepository;
}) {
  const situationsService =
    dependencies?.situations ?? createConsolidatedSituationsService();
  const situationPrioritization =
    dependencies?.situationPrioritization ?? createSituationPrioritizationService();
  const emails = dependencies?.emails ?? createEmailsRepository(prisma);
  const events = dependencies?.events ?? createCalendarEventsRepository(prisma);
  const signals = dependencies?.signals ?? createSignalsRepository(prisma);
  const interventions = dependencies?.interventions ?? createInterventionsRepository(prisma);

  return {
    async evaluate(userId: string, now: Date = new Date()): Promise<AssistantEvaluationOutcome> {
      const situations = await situationsService.getSituations(userId, now);
      if (situations.length === 0) {
        return { ok: true, results: [] };
      }

      const aiOutcome = await situationPrioritization.prioritize(userId, now);
      if (!aiOutcome.ok) {
        // Preserve existing deterministic signals/interventions untouched;
        // never fabricate a priority/message when the AI layer failed.
        return { ok: false, code: aiOutcome.code, message: aiOutcome.message };
      }

      const aiResultsBySituationId = new Map(
        aiOutcome.prioritizedSituations.map((result) => [result.situationId, result]),
      );

      const [recentEmails, upcomingEvents, openSignals] = await Promise.all([
        emails.listRecent(userId, CONTEXT_FETCH_LIMIT),
        events.listUpcoming(userId, CONTEXT_FETCH_LIMIT, now),
        signals.listOpen(userId),
      ]);
      const emailsById = new Map(recentEmails.map((email) => [email.id, email]));
      const eventsById = new Map(upcomingEvents.map((event) => [event.id, event]));
      const signalsById = new Map(openSignals.map((signal) => [signal.id, signal]));

      const results = [];
      for (const situation of situations) {
        const existingByAnySignal = await Promise.all(
          situation.signalIds.map((signalId) => interventions.findBySignalId(signalId)),
        );
        const existingIntervention = existingByAnySignal.find((entry) => entry !== null) ?? null;

        const primarySignal = signalsById.get(situation.primarySignalId) ?? null;
        const email = emailsById.get(situation.emailIds[0] ?? "") ?? null;
        const event = eventsById.get(situation.calendarEventIds[0] ?? "") ?? null;

        const decision = evaluateAssistantDecision({
          situation,
          aiResult: aiResultsBySituationId.get(situation.id),
          existingInterventionId: existingIntervention?.id ?? null,
          primarySignalSourceType:
            (primarySignal?.sourceType as "email" | "calendar_event" | undefined) ?? null,
          primarySignalTitle: primarySignal?.title ?? null,
          emailSourceUrl: email?.sourceUrl ?? null,
          calendarSourceUrl: event?.sourceUrl ?? null,
        });

        if (decision.intent === "reuse") {
          results.push({
            situationId: decision.situationId,
            eligible: decision.eligible,
            priority: decision.priority,
            interventionId: decision.existingInterventionId,
            outcome: "reused" as const,
            message: null,
          });
          continue;
        }

        if (decision.intent === "skip") {
          results.push({
            situationId: decision.situationId,
            eligible: decision.eligible,
            priority: decision.priority,
            interventionId: null,
            outcome: "skipped" as const,
            message: null,
          });
          continue;
        }

        // intent === "create" only occurs when the evaluator already
        // resolved a concrete AI priority, so this is always non-null here.
        const priority = decision.priority ?? "medium";

        const created = await interventions.create({
          userId,
          signalId: decision.primarySignalId,
          priority,
          title: decision.title ?? "Needs your attention",
          message: decision.message ?? "",
          reason: decision.reason ?? "",
          actionType: decision.action ? "open_source" : "none",
          actionPayload: decision.action
            ? { sourceUrl: decision.action.sourceUrl, availableActions: AVAILABLE_ACTIONS }
            : null,
        });

        results.push({
          situationId: decision.situationId,
          eligible: decision.eligible,
          priority: decision.priority,
          interventionId: created.id,
          outcome: "created" as const,
          message: decision.message,
        });
      }

      return { ok: true, results };
    },
  };
}

export type AssistantEvaluationService = ReturnType<typeof createAssistantEvaluationService>;
