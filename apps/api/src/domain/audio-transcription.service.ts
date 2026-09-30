import { classifyLlmFailure, type LlmProvider } from "../providers/llm/llm-provider.js";
import { providerFailureMessage, type ProviderFailureCode } from "./llm-failure-messages.js";
import { createDefaultLlmProvider } from "./llm-usage.service.js";

export type TranscriptionFailureCode = ProviderFailureCode | "empty";

export type TranscriptionOutcome =
  | { ok: true; text: string }
  | { ok: false; code: TranscriptionFailureCode; message: string };

/** How Hindi words are written in the transcript (Settings → Voice). Roman = how the user types Hinglish. */
export type HindiScript = "latin" | "devanagari";

/**
 * The user may speak English, Hindi, or a mix (Hinglish). The prompt is a
 * short example in the wanted style — transcription models follow the
 * prompt's language and script — and `languages` (gpt-transcribe) says the
 * audio may be English or Hindi, never forcing either.
 */
export const TRANSCRIPTION_PROMPTS: Record<HindiScript, string> = {
  latin:
    "Hinglish conversation, Hindi written in Roman letters: Haan, kal subah 10 baje meeting hai, please reminder set kar do. Rahul ko email bhejna hai, aur budget report bhi check karni hai.",
  devanagari:
    "हिंदी और अंग्रेज़ी मिली हुई बातचीत: हाँ, कल सुबह 10 बजे meeting है, please reminder set कर दो। Rahul को email भेजना है, और budget report भी check करनी है।",
};
export const TRANSCRIPTION_LANGUAGES = ["en", "hi"];

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
    async transcribe(
      audio: Buffer,
      mimeType: string,
      durationSeconds?: number,
      script: HindiScript = "latin",
    ): Promise<TranscriptionOutcome> {
      let text: string;
      try {
        text = await provider.transcribeAudio({
          audio,
          mimeType,
          operation: "transcription",
          prompt: TRANSCRIPTION_PROMPTS[script],
          languages: TRANSCRIPTION_LANGUAGES,
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
