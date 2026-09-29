import OpenAI, { toFile } from "openai";
import type { ResponseFormatJSONSchema } from "openai/resources/shared.js";
import { env } from "../../config/env.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// Was "qwen/qwen3-32b" until Groq retired it (404 model_not_found, found
// Sept 28, 2026 — the packaged app has no GROQ_MODEL override, so every
// Groq call there failed while dev, which sets GROQ_MODEL, kept working).
const DEFAULT_MODEL = "qwen/qwen3.8-27b";
// Groq's fast Whisper variant — good enough for short spoken commands
// ("remind me to..."), not full-length dictation/transcription accuracy.
const DEFAULT_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

export interface StructuredCompletionRequest {
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Upper bound on the reply length; defaults to DEFAULT_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
}

/**
 * Groq budgets a request against its output-tokens-per-minute limit using
 * the *maximum* reply length, not the actual one. Left unset, the model's
 * default (2048) exceeded the free plan's 1,000/minute limit, so every
 * request was rejected with 429 rate_limit_exceeded (found Sept 28, 2026).
 * Always sending an explicit cap below that limit fixes it; callers pass a
 * tighter one sized to their schema.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 800;

export interface TranscriptionRequest {
  audio: Buffer;
  /** e.g. "audio/webm" — used to pick a matching filename extension for the upload; Whisper mostly infers format from content anyway. */
  mimeType: string;
}

export interface GroqProvider {
  /** Returns the raw JSON text produced by the model — not yet parsed/validated. */
  createStructuredCompletion(request: StructuredCompletionRequest): Promise<string>;
  /** Returns the raw transcribed text. */
  transcribeAudio(request: TranscriptionRequest): Promise<string>;
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export type GroqFailureKind =
  | "not_configured"
  | "auth_rejected"
  | "model_unavailable"
  | "unavailable"
  | "failed";

/** Typed provider failure, so callers can tell a bad API key apart from a transient outage without matching on message text. */
export class GroqProviderError extends Error {
  readonly kind: GroqFailureKind;
  /**
   * Short, safe diagnostic — HTTP status plus Groq's machine-readable error
   * code, e.g. "HTTP 429 rate_limit_exceeded" or "network error". Never the
   * raw provider message or payload. Surfaced to the user so a failure in
   * the packaged app (which has no log file) can be diagnosed from the
   * screen alone.
   */
  readonly detail: string | null;

  constructor(kind: GroqFailureKind, message: string, detail: string | null = null) {
    super(message);
    this.name = "GroqProviderError";
    this.kind = kind;
    this.detail = detail;
  }
}

/** The GroqProviderError's diagnostic detail, if the error carries one. */
export function groqFailureDetail(err: unknown): string | null {
  return err instanceof GroqProviderError ? err.detail : null;
}

function describeGroqError(err: unknown, status: number | undefined): string {
  if (status === undefined) return "network error";
  const raw = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  // Only well-formed identifiers ("rate_limit_exceeded") — never free text.
  const code = typeof raw === "string" && /^[a-z0-9_]{1,64}$/i.test(raw) ? ` ${raw}` : "";
  return `HTTP ${status}${code}`;
}

/** Classifies anything a GroqProvider call threw. Falls back to "not configured" message matching for plain Errors (e.g. test doubles). */
export function classifyGroqFailure(err: unknown): GroqFailureKind {
  if (err instanceof GroqProviderError) return err.kind;
  if (err instanceof Error && /not configured/i.test(err.message)) return "not_configured";
  return "failed";
}

function notConfiguredError(): GroqProviderError {
  return new GroqProviderError("not_configured", "Groq is not configured. Set GROQ_API_KEY.");
}

/** Maps a Groq SDK error into a safe, generic Error — never leaks raw provider payloads. */
function mapGroqError(err: unknown): GroqProviderError {
  const status = extractStatus(err);
  const detail = describeGroqError(err, status);
  if (status === 401 || status === 403) {
    return new GroqProviderError("auth_rejected", "Groq rejected the request credentials.", detail);
  }
  if (status === 404) {
    return new GroqProviderError(
      "model_unavailable",
      "The configured Groq model does not exist or is not available to this key.",
      detail,
    );
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new GroqProviderError(
      "unavailable",
      "Groq is temporarily unavailable. Try again shortly.",
      detail,
    );
  }
  return new GroqProviderError("failed", "Groq request failed.", detail);
}

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};

export function createGroqProvider(overrides?: {
  apiKey?: string;
  model?: string;
  transcribeModel?: string;
}): GroqProvider {
  const apiKey = overrides?.apiKey ?? env.GROQ_API_KEY;
  const model = overrides?.model ?? env.GROQ_MODEL ?? DEFAULT_MODEL;
  const transcribeModel =
    overrides?.transcribeModel ?? env.GROQ_TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIBE_MODEL;

  return {
    async createStructuredCompletion(request) {
      if (!apiKey) {
        throw notConfiguredError();
      }

      const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });

      let outputText: string | null | undefined;
      try {
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: request.instructions },
            { role: "user", content: request.input },
          ],
          max_completion_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.schemaName,
              schema: request.jsonSchema,
              strict: true,
            },
          } satisfies ResponseFormatJSONSchema,
        });
        outputText = response.choices[0]?.message?.content;
      } catch (err) {
        throw mapGroqError(err);
      }

      if (!outputText) {
        throw new Error("Groq returned an empty response.");
      }
      return outputText;
    },

    async transcribeAudio(request) {
      if (!apiKey) {
        throw notConfiguredError();
      }

      const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
      const extension = MIME_EXTENSIONS[request.mimeType] ?? "webm";

      let text: string | undefined;
      try {
        const response = await client.audio.transcriptions.create({
          model: transcribeModel,
          file: await toFile(request.audio, `recording.${extension}`, {
            type: request.mimeType,
          }),
        });
        text = response.text;
      } catch (err) {
        throw mapGroqError(err);
      }

      if (!text) {
        throw new Error("Groq returned an empty transcription.");
      }
      return text;
    },
  };
}
