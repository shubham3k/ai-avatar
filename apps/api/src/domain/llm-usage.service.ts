import type { LlmUsage } from "@prisma/client";
import {
  createLlmUsageRepository,
  type LlmUsageRepository,
} from "../db/repositories/llm-usage.repository.js";
import { prisma } from "../lib/prisma.js";
import { createLlmProvider } from "../providers/llm/create-llm-provider.js";
import type { LlmProvider, LlmUsageEvent } from "../providers/llm/llm-provider.js";
import { estimateCostUsd } from "../providers/llm/pricing.js";

export interface ProviderUsage {
  calls: number;
  /** Null when none of this provider's calls could be priced (e.g. Groq). */
  costUsd: number | null;
}

export interface LlmUsageSummary {
  /** Start of the current calendar month, local time, ISO-8601. */
  since: string;
  calls: number;
  /** Estimated total of priced calls. */
  estimatedCostUsd: number;
  openai: ProviderUsage;
  groq: ProviderUsage;
}

function startOfLocalMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function summarizeProvider(rows: LlmUsage[]): ProviderUsage {
  const priced = rows.filter((row) => row.costUsd !== null);
  return {
    calls: rows.length,
    costUsd: priced.length === 0 ? null : priced.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
  };
}

export function createLlmUsageService(dependencies?: { usage?: LlmUsageRepository }) {
  const usage = dependencies?.usage ?? createLlmUsageRepository(prisma);

  return {
    /** Stores one call's counts with its estimated cost. Never throws — usage tracking must not break the call it describes. */
    async record(event: LlmUsageEvent): Promise<void> {
      try {
        await usage.record({ ...event, costUsd: estimateCostUsd(event) });
      } catch {
        // Best-effort by design.
      }
    },

    async summary(now: Date = new Date()): Promise<LlmUsageSummary> {
      const since = startOfLocalMonth(now);
      const rows = await usage.listSince(since);
      const openai = summarizeProvider(rows.filter((row) => row.provider === "openai"));
      const groq = summarizeProvider(rows.filter((row) => row.provider === "groq"));
      return {
        since: since.toISOString(),
        calls: rows.length,
        estimatedCostUsd: (openai.costUsd ?? 0) + (groq.costUsd ?? 0),
        openai,
        groq,
      };
    },
  };
}

export type LlmUsageService = ReturnType<typeof createLlmUsageService>;

/**
 * The provider every domain service uses by default: OpenAI with the Groq
 * fallback (per configured keys), with each successful call's usage
 * recorded for "usage this month".
 */
export function createDefaultLlmProvider(): LlmProvider {
  const usageService = createLlmUsageService();
  return createLlmProvider({
    onUsage: (event) => {
      void usageService.record(event);
    },
  });
}
