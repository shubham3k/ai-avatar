import { describe, expect, it, vi } from "vitest";
import type { LlmUsage } from "@prisma/client";
import { createLlmUsageService } from "./llm-usage.service.js";
import type { LlmUsageRepository } from "../db/repositories/llm-usage.repository.js";

function row(overrides: Partial<LlmUsage>): LlmUsage {
  return {
    id: Math.random().toString(36),
    createdAt: new Date(),
    provider: "openai",
    model: "gpt-6-luna",
    operation: "reminder_parse",
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    audioSeconds: 0,
    costUsd: 0,
    ...overrides,
  };
}

function repo(rows: LlmUsage[] = []): LlmUsageRepository {
  return {
    record: vi.fn().mockResolvedValue(row({})),
    listSince: vi.fn().mockResolvedValue(rows),
  };
}

describe("llm usage service", () => {
  it("records an event with its estimated cost", async () => {
    const usage = repo();
    await createLlmUsageService({ usage }).record({
      provider: "openai",
      model: "gpt-6-luna",
      operation: "reminder_parse",
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 0,
      audioSeconds: 0,
    });

    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 1_000_000, costUsd: 0.1 }));
  });

  it("never throws if recording fails — usage tracking must not break the call it describes", async () => {
    const usage = repo();
    (usage.record as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db locked"));

    await expect(
      createLlmUsageService({ usage }).record({
        provider: "groq",
        model: "m",
        operation: "other",
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        audioSeconds: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it("summarizes the current local month per provider", async () => {
    const usage = repo([
      row({ costUsd: 0.02 }),
      row({ costUsd: 0.03 }),
      row({ provider: "groq", model: "openai/gpt-oss-120b", costUsd: null }),
    ]);
    const now = new Date(2026, 8, 29, 11, 0, 0);

    const summary = await createLlmUsageService({ usage }).summary(now);

    expect(usage.listSince).toHaveBeenCalledWith(new Date(2026, 8, 1, 0, 0, 0, 0));
    expect(summary).toMatchObject({
      calls: 3,
      openai: { calls: 2 },
      groq: { calls: 1, costUsd: null },
    });
    expect(summary.estimatedCostUsd).toBeCloseTo(0.05, 10);
    expect(summary.openai.costUsd).toBeCloseTo(0.05, 10);
  });

  it("reports zero usage cleanly at the start of a month", async () => {
    const summary = await createLlmUsageService({ usage: repo([]) }).summary(new Date(2026, 9, 1));
    expect(summary).toMatchObject({
      calls: 0,
      estimatedCostUsd: 0,
      openai: { calls: 0, costUsd: null },
      groq: { calls: 0, costUsd: null },
    });
  });
});
