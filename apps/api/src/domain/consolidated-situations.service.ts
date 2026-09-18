import { evaluateConsolidatedSituations } from "./context/consolidated-situation.evaluator.js";
import type {
  ConsolidatedSituation,
  SituationSignalInput,
} from "./context/consolidated-situation.types.js";
import {
  createCrossSourceContextService,
  type CrossSourceContextService,
} from "./cross-source-context.service.js";
import {
  createSignalsRepository,
  type SignalsRepository,
} from "../db/repositories/interventions.repository.js";
import { prisma } from "../lib/prisma.js";

export function createConsolidatedSituationsService(dependencies?: {
  signals?: SignalsRepository;
  context?: CrossSourceContextService;
}) {
  const signals = dependencies?.signals ?? createSignalsRepository(prisma);
  const context = dependencies?.context ?? createCrossSourceContextService();

  return {
    async getSituations(
      userId: string,
      now: Date = new Date(),
    ): Promise<ConsolidatedSituation[]> {
      const [openSignals, contexts] = await Promise.all([
        signals.listOpen(userId),
        context.getContext(userId, now),
      ]);

      const signalInputs: SituationSignalInput[] = openSignals.map((signal) => ({
        id: signal.id,
        sourceType: signal.sourceType,
        sourceId: signal.sourceId,
        dueAt: signal.dueAt,
        createdAt: signal.createdAt,
        importanceHints: signal.importanceHints,
      }));

      return evaluateConsolidatedSituations(signalInputs, contexts);
    },
  };
}

export type ConsolidatedSituationsService = ReturnType<
  typeof createConsolidatedSituationsService
>;
