import { env } from "../../config/env.js";
import type { LlmProvider, LlmUsageListener } from "../llm/llm-provider.js";
import { createOpenAiCompatibleProvider } from "../llm/openai-compatible-client.js";

// Provider-neutral types/errors now live in ../llm/llm-provider.ts (ADR-006);
// re-exported under their original Groq names so existing imports keep working.
export {
  DEFAULT_MAX_OUTPUT_TOKENS,
  LlmProviderError as GroqProviderError,
  classifyLlmFailure as classifyGroqFailure,
  llmFailureDetail as groqFailureDetail,
  type LlmFailureKind as GroqFailureKind,
  type LlmProvider as GroqProvider,
  type StructuredCompletionRequest,
  type TranscriptionRequest,
} from "../llm/llm-provider.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// Was "qwen/qwen3-32b" until Groq retired it (404 model_not_found, found
// Sept 28, 2026 — the packaged app has no GROQ_MODEL override, so every
// Groq call there failed while dev, which sets GROQ_MODEL, kept working).
const DEFAULT_MODEL = "qwen/qwen3.8-27b";
// Groq's fast Whisper variant — good enough for short spoken commands
// ("remind me to..."), not full-length dictation/transcription accuracy.
// The full model is noticeably better than -turbo at Hindi/Hinglish (M4 follow-up); Groq is only the backup.
const DEFAULT_TRANSCRIBE_MODEL = "whisper-large-v3";

/** Groq — the optional fallback provider since ADR-006 (the primary before it). */
export function createGroqProvider(overrides?: {
  apiKey?: string;
  model?: string;
  transcribeModel?: string;
  onUsage?: LlmUsageListener;
}): LlmProvider {
  return createOpenAiCompatibleProvider({
    provider: "groq",
    apiKey: overrides?.apiKey ?? env.GROQ_API_KEY,
    baseURL: GROQ_BASE_URL,
    model: overrides?.model ?? env.GROQ_MODEL ?? DEFAULT_MODEL,
    transcribeModel: overrides?.transcribeModel ?? env.GROQ_TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIBE_MODEL,
    ...(overrides?.onUsage ? { onUsage: overrides.onUsage } : {}),
  });
}
