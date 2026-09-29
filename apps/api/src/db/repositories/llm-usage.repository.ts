import type { LlmUsage, PrismaClient } from "@prisma/client";

export interface RecordLlmUsageInput {
  provider: string;
  model: string;
  operation: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  costUsd: number | null;
}

export interface LlmUsageRepository {
  record(input: RecordLlmUsageInput): Promise<LlmUsage>;
  /** Every usage row created at or after `since`. */
  listSince(since: Date): Promise<LlmUsage[]>;
}

export function createLlmUsageRepository(prisma: PrismaClient): LlmUsageRepository {
  return {
    record(input) {
      return prisma.llmUsage.create({ data: input });
    },
    listSince(since) {
      return prisma.llmUsage.findMany({ where: { createdAt: { gte: since } } });
    },
  };
}
