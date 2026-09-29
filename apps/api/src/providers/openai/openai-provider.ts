import { env } from "../../config/env.js";
import type { LlmProvider, LlmUsageListener } from "../llm/llm-provider.js";
import { createOpenAiCompatibleProvider } from "../llm/openai-compatible-client.js";

/**
 * Defaults chosen in ADR-006 (Sept 28, 2026 pricing): gpt-6-luna is the
 * cheapest model in OpenAI's current flagship family that reliably handles
 * tool use. Transcription: see DEFAULT_OPENAI_TRANSCRIBE_MODEL below.
 * Both are overridable from Settings (OPENAI_MODEL) / env.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";
/**
 * M4 follow-up (Sept 29, 2026): the user found Hindi/Hinglish recognition
 * weak with gpt-4o-mini-transcribe. gpt-transcribe (the upgrade path named
 * in ADR-006, ~$0.0045/min) is more accurate and accepts a `languages`
 * hint (English + Hindi) for mixed speech.
 */
export const DEFAULT_OPENAI_TRANSCRIBE_MODEL = "gpt-transcribe";

/** Models offered in the Settings picker — cheapest first. */
export const OPENAI_MODEL_CHOICES = ["gpt-5-nano", "gpt-6-luna", "gpt-6-sol"] as const;

export function createOpenAiProvider(overrides?: {
  apiKey?: string;
  model?: string;
  transcribeModel?: string;
  onUsage?: LlmUsageListener;
}): LlmProvider {
  const transcribeModel =
    overrides?.transcribeModel ?? env.OPENAI_TRANSCRIBE_MODEL ?? DEFAULT_OPENAI_TRANSCRIBE_MODEL;
  return createOpenAiCompatibleProvider({
    provider: "openai",
    transcribeLanguageHints: transcribeModel.startsWith("gpt-transcribe"),
    apiKey: overrides?.apiKey ?? env.OPENAI_API_KEY,
    model: overrides?.model ?? env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    transcribeModel,
    extraChatParams: {
      // Local-first (ADR-006): don't have OpenAI keep application state;
      // conversations live only in the local database.
      store: false,
      // gpt-6-luna is a reasoning model (default effort "medium"). Chat
      // Completions only supports function calling with reasoning "none",
      // and reasoning tokens would otherwise eat into max_completion_tokens.
      reasoning_effort: "none",
    },
    streamUsage: true,
    ...(overrides?.onUsage ? { onUsage: overrides.onUsage } : {}),
  });
}
