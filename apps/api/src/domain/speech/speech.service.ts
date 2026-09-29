import { classifyLlmFailure, type SpeechProvider } from "../../providers/llm/llm-provider.js";
import { providerFailureMessage, type ProviderFailureCode } from "../llm-failure-messages.js";
import { createDefaultSpeechProvider } from "../llm-usage.service.js";

/**
 * Tone and pronunciation guidance for gpt-4o-mini-tts (ADR-006 §5): Zara
 * speaks English, Hindi, and Hinglish.
 */
export const ZARA_VOICE_INSTRUCTIONS =
  "You are Zara, a friendly personal assistant. Speak warmly, clearly, and at a relaxed conversational pace. " +
  "When the text is Hindi or Hinglish (Hindi written in Latin letters, often mixed with English), pronounce it naturally, like a fluent Indian speaker.";

export type SpeechOutcome =
  | { ok: true; audio: Buffer }
  | { ok: false; code: ProviderFailureCode; message: string };

/** M4: Zara's spoken voice, with outcome-based errors like transcription. */
export function createSpeechService(dependencies?: { provider?: SpeechProvider }) {
  const provider = dependencies?.provider ?? createDefaultSpeechProvider();

  return {
    async speak(text: string, voice: string): Promise<SpeechOutcome> {
      try {
        const audio = await provider.synthesizeSpeech({ text, voice, instructions: ZARA_VOICE_INSTRUCTIONS });
        return { ok: true, audio };
      } catch (err) {
        const kind = classifyLlmFailure(err);
        const code: ProviderFailureCode =
          kind === "not_configured" || kind === "auth_rejected" || kind === "model_unavailable"
            ? kind
            : "provider_error";
        return { ok: false, code, message: providerFailureMessage(code, err, "Zara's OpenAI voice") };
      }
    },
  };
}

export type SpeechService = ReturnType<typeof createSpeechService>;
