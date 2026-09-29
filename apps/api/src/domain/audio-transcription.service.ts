import { classifyLlmFailure, type LlmProvider } from "../providers/llm/llm-provider.js";
import { providerFailureMessage, type ProviderFailureCode } from "./llm-failure-messages.js";
import { createDefaultLlmProvider } from "./llm-usage.service.js";

export type TranscriptionFailureCode = ProviderFailureCode | "empty";

export type TranscriptionOutcome =
  | { ok: true; text: string }
  | { ok: false; code: TranscriptionFailureCode; message: string };

/**
 * M4: the user may speak English, Hindi, or a mix of both. The hint helps
 * the model with mixed-language speech; it never forces a language.
 */
export const TRANSCRIPTION_LANGUAGE_HINT =
  "The speaker may use English, Hindi, or Hinglish (Hindi and English mixed in one sentence).";

export const EMPTY_TRANSCRIPTION_MESSAGE = "Didn't catch anything — try recording again.";

/**
 * Thin wrapper over LlmProvider.transcribeAudio with the same
 * outcome-based error handling as reminder-parsing.service.ts, so callers
 * never have to catch a raw provider exception. Not reminder-specific —
 * anything needing "audio in, text out" can use this.
 */
export function createAudioTranscriptionService(dependencies?: { provider?: LlmProvider }) {
  const provider = dependencies?.provider ?? createDefaultLlmProvider();

  return {
    async transcribe(audio: Buffer, mimeType: string, durationSeconds?: number): Promise<TranscriptionOutcome> {
      let text: string;
      try {
        text = await provider.transcribeAudio({
          audio,
          mimeType,
          operation: "transcription",
          prompt: TRANSCRIPTION_LANGUAGE_HINT,
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        });
      } catch (err) {
        const kind = classifyLlmFailure(err);
        const code: ProviderFailureCode =
          kind === "not_configured" || kind === "auth_rejected" || kind === "model_unavailable"
            ? kind
            : "provider_error";
        return { ok: false, code, message: providerFailureMessage(code, err, "voice reminders") };
      }

      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return { ok: false, code: "empty", message: EMPTY_TRANSCRIPTION_MESSAGE };
      }
      return { ok: true, text: trimmed };
    },
  };
}

export type AudioTranscriptionService = ReturnType<typeof createAudioTranscriptionService>;
