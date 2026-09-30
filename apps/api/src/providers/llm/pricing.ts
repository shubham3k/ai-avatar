import type { LlmUsageEvent } from "./llm-provider.js";

/**
 * Prices used to *estimate* "usage this month" in Settings. Taken from
 * OpenAI's pricing page on Sept 28, 2026 (developers.openai.com/api/docs/pricing)
 * — providers change prices, so this is an estimate, never a bill. The
 * OpenAI dashboard remains the source of truth (and where the hard spending
 * cap lives). Groq prices aren't listed: its free tier costs nothing and paid
 * prices weren't verified from a first-party source, so Groq calls are
 * counted but not costed.
 */
interface TokenPrice {
  /** USD per 1M tokens. */
  input: number;
  cachedInput: number;
  output: number;
}

const TOKEN_PRICES: Record<string, TokenPrice> = {
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6-sol": { input: 2.0, cachedInput: 0.2, output: 10.0 },
};

/** USD per minute of audio. */
const TRANSCRIPTION_PRICES: Record<string, number> = {
  "gpt-4o-mini-transcribe": 0.003,
  "gpt-transcribe": 0.0045,
  "gpt-4o-transcribe": 0.006,
  "whisper-1": 0.006,
};

/**
 * USD per minute of generated speech — OpenAI's own per-minute estimate for
 * gpt-4o-mini-tts (it's billed per text + audio token; $0.60 / $12 per 1M).
 */
const SPEECH_PRICES: Record<string, number> = {
  "gpt-4o-mini-tts": 0.015,
};

/** Estimated USD cost of one call, or null when the model's price isn't known. */
export function estimateCostUsd(event: LlmUsageEvent): number | null {
  if (event.provider !== "openai") return null;

  if (event.operation === "speech") {
    const perMinute = SPEECH_PRICES[event.model];
    return perMinute === undefined ? null : (event.audioSeconds / 60) * perMinute;
  }

  if (event.audioSeconds > 0 || event.operation === "transcription") {
    const perMinute = TRANSCRIPTION_PRICES[event.model];
    return perMinute === undefined ? null : (event.audioSeconds / 60) * perMinute;
  }

  const price = TOKEN_PRICES[event.model];
  if (!price) return null;
  const cached = Math.min(event.cachedInputTokens, event.inputTokens);
  const uncached = event.inputTokens - cached;
  return (uncached * price.input + cached * price.cachedInput + event.outputTokens * price.output) / 1_000_000;
}
