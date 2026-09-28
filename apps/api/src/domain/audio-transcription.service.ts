import {
  classifyGroqFailure,
  createGroqProvider,
  groqFailureDetail,
  type GroqProvider,
} from "../providers/groq/groq-client.js";

export type TranscriptionFailureCode =
  | "not_configured"
  | "auth_rejected"
  | "model_unavailable"
  | "provider_error"
  | "empty";

export type TranscriptionOutcome =
  | { ok: true; text: string }
  | { ok: false; code: TranscriptionFailureCode; message: string };

/** User-facing, shown as-is in the desktop Settings panel. */
export const TRANSCRIPTION_FAILURE_MESSAGES = {
  not_configured: "Add your Groq API key in Settings to use voice reminders.",
  auth_rejected: "Your Groq API key was rejected. Update it in Settings.",
  model_unavailable:
    "The voice model this app uses is no longer available on Groq. The app needs an update.",
  provider_error: "Voice transcription is unavailable right now. Try again in a moment.",
  empty: "Didn't catch anything — try recording again.",
} as const satisfies Record<TranscriptionFailureCode, string>;

function failure(code: TranscriptionFailureCode, detail: string | null = null): TranscriptionOutcome {
  const base = TRANSCRIPTION_FAILURE_MESSAGES[code];
  return { ok: false, code, message: detail ? `${base} (Groq: ${detail})` : base };
}

/**
 * Thin wrapper over GroqProvider.transcribeAudio with the same
 * outcome-based error handling as reminder-parsing.service.ts, so callers
 * never have to catch a raw provider exception. Not reminder-specific —
 * anything needing "audio in, text out" can use this.
 */
export function createAudioTranscriptionService(dependencies?: { provider?: GroqProvider }) {
  const provider = dependencies?.provider ?? createGroqProvider();

  return {
    async transcribe(audio: Buffer, mimeType: string): Promise<TranscriptionOutcome> {
      let text: string;
      try {
        text = await provider.transcribeAudio({ audio, mimeType });
      } catch (err) {
        const kind = classifyGroqFailure(err);
        if (kind === "not_configured") return failure("not_configured");
        if (kind === "auth_rejected") return failure("auth_rejected");
        if (kind === "model_unavailable") return failure("model_unavailable", groqFailureDetail(err));
        return failure("provider_error", groqFailureDetail(err));
      }

      const trimmed = text.trim();
      if (trimmed.length === 0) return failure("empty");
      return { ok: true, text: trimmed };
    },
  };
}

export type AudioTranscriptionService = ReturnType<typeof createAudioTranscriptionService>;
