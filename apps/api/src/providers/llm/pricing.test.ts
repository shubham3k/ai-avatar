import { describe, expect, it } from "vitest";
import type { LlmUsageEvent } from "./llm-provider.js";
import { estimateCostUsd } from "./pricing.js";

function event(overrides: Partial<LlmUsageEvent>): LlmUsageEvent {
  return {
    provider: "openai",
    model: "gpt-6-luna",
    operation: "reminder_parse",
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    audioSeconds: 0,
    ...overrides,
  };
}

describe("estimateCostUsd", () => {
  it("prices gpt-6-luna tokens, charging cached input at the cached rate", () => {
    // 1M uncached in ($0.10) + 1M cached in ($0.01) + 1M out ($0.50)
    const cost = estimateCostUsd(
      event({ inputTokens: 2_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 }),
    );
    expect(cost).toBeCloseTo(0.61, 10);
  });

  it("never counts more cached tokens than input tokens", () => {
    expect(estimateCostUsd(event({ inputTokens: 1_000_000, cachedInputTokens: 5_000_000 }))).toBeCloseTo(0.01, 10);
  });

  it("prices transcription per minute of audio", () => {
    expect(
      estimateCostUsd(event({ model: "gpt-4o-mini-transcribe", operation: "transcription", audioSeconds: 120 })),
    ).toBeCloseTo(0.006, 10);
  });

  it("prices generated speech per estimated minute (M4)", () => {
    expect(estimateCostUsd(event({ model: "gpt-4o-mini-tts", operation: "speech", audioSeconds: 60 }))).toBeCloseTo(
      0.015,
      10,
    );
  });

  it("returns null for unknown models and for Groq (counted, not costed)", () => {
    expect(estimateCostUsd(event({ model: "gpt-unknown", inputTokens: 1000 }))).toBeNull();
    expect(estimateCostUsd(event({ provider: "groq", model: "openai/gpt-oss-120b", inputTokens: 1000 }))).toBeNull();
  });
});
