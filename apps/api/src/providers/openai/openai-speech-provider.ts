import OpenAI from "openai";
import { env } from "../../config/env.js";
import { redact } from "../../domain/privacy/redaction.js";
import { LlmProviderError, type LlmUsageListener, type SpeechProvider } from "../llm/llm-provider.js";
import { mapError } from "../llm/openai-compatible-client.js";

/** ADR-006 §2: Zara's voice. */
export const DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts";

/**
 * Speech is billed by audio produced, which the API doesn't report back, so
 * usage is estimated from the text: ~15 characters per second of speech.
 */
const CHARS_PER_SECOND = 15;

export function estimateSpeechSeconds(text: string): number {
  return Math.max(1, Math.round(text.length / CHARS_PER_SECOND));
}

/**
 * OpenAI text-to-speech (M4). The text is redacted first — the same
 * provider-boundary rule as every other AI request (ADR-006 §1).
 */
export function createOpenAiSpeechProvider(overrides?: {
  apiKey?: string;
  model?: string;
  onUsage?: LlmUsageListener;
}): SpeechProvider {
  const apiKey = overrides?.apiKey ?? env.OPENAI_API_KEY;
  const model = overrides?.model ?? env.OPENAI_TTS_MODEL ?? DEFAULT_OPENAI_TTS_MODEL;

  return {
    async synthesizeSpeech(request) {
      if (!apiKey) {
        throw new LlmProviderError(
          "not_configured",
          "OpenAI is not configured. Add its API key in Settings.",
          null,
          "openai",
        );
      }
      const input = redact(request.text);
      const client = new OpenAI({ apiKey });
      let audio: Buffer;
      try {
        const response = await client.audio.speech.create({
          model,
          voice: request.voice,
          input,
          response_format: "mp3",
          ...(request.instructions ? { instructions: request.instructions } : {}),
        });
        audio = Buffer.from(await response.arrayBuffer());
      } catch (err) {
        throw mapError(err, "openai");
      }
      overrides?.onUsage?.({
        provider: "openai",
        model,
        operation: "speech",
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        audioSeconds: estimateSpeechSeconds(input),
      });
      return audio;
    },
  };
}
