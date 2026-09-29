import OpenAI, { toFile } from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions.js";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  LlmProviderError,
  PROVIDER_LABELS,
  type LlmProvider,
  type LlmProviderName,
  type LlmUsageListener,
} from "./llm-provider.js";

export interface OpenAiCompatibleConfig {
  provider: LlmProviderName;
  apiKey: string | undefined;
  /** Omit for OpenAI itself; Groq passes its OpenAI-compatible endpoint. */
  baseURL?: string;
  model: string;
  transcribeModel: string;
  /** Provider-specific Chat Completions fields (e.g. OpenAI's `store: false`, `reasoning_effort`). */
  extraChatParams?: Record<string, unknown>;
  onUsage?: LlmUsageListener;
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function describeError(err: unknown, status: number | undefined): string {
  if (status === undefined) return "network error";
  const raw = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  // Only well-formed identifiers ("rate_limit_exceeded") — never free text.
  const code = typeof raw === "string" && /^[a-z0-9_]{1,64}$/i.test(raw) ? ` ${raw}` : "";
  return `HTTP ${status}${code}`;
}

/** Maps an SDK error into a safe, typed error — never leaks raw provider payloads. */
function mapError(err: unknown, provider: LlmProviderName): LlmProviderError {
  const label = PROVIDER_LABELS[provider];
  const status = extractStatus(err);
  const detail = describeError(err, status);
  if (status === 401 || status === 403) {
    return new LlmProviderError("auth_rejected", `${label} rejected the request credentials.`, detail, provider);
  }
  if (status === 404) {
    return new LlmProviderError(
      "model_unavailable",
      `The configured ${label} model does not exist or is not available to this key.`,
      detail,
      provider,
    );
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new LlmProviderError(
      "unavailable",
      `${label} is temporarily unavailable. Try again shortly.`,
      detail,
      provider,
    );
  }
  return new LlmProviderError("failed", `${label} request failed.`, detail, provider);
}

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};

/** "audio/webm;codecs=opus" → "audio/webm". */
function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]!.trim().toLowerCase();
}

/**
 * One implementation for every OpenAI-compatible provider. Usage (token
 * counts, audio seconds — never content) is reported through onUsage after
 * each successful call.
 */
export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  const label = PROVIDER_LABELS[config.provider];

  function client(): OpenAI {
    if (!config.apiKey) {
      throw new LlmProviderError(
        "not_configured",
        `${label} is not configured. Add its API key in Settings.`,
        null,
        config.provider,
      );
    }
    return new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
  }

  return {
    async createStructuredCompletion(request) {
      const api = client();
      const body = {
        model: config.model,
        messages: [
          { role: "system", content: request.instructions },
          { role: "user", content: request.input },
        ],
        max_completion_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        response_format: {
          type: "json_schema",
          json_schema: { name: request.schemaName, schema: request.jsonSchema, strict: true },
        },
        ...config.extraChatParams,
      } as ChatCompletionCreateParamsNonStreaming;

      let outputText: string | null | undefined;
      try {
        const response = await api.chat.completions.create(body);
        outputText = response.choices[0]?.message?.content;
        config.onUsage?.({
          provider: config.provider,
          model: config.model,
          operation: request.operation ?? "other",
          inputTokens: response.usage?.prompt_tokens ?? 0,
          cachedInputTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          audioSeconds: 0,
        });
      } catch (err) {
        throw mapError(err, config.provider);
      }

      if (!outputText) {
        throw new LlmProviderError("failed", `${label} returned an empty response.`, "empty response", config.provider);
      }
      return outputText;
    },

    async transcribeAudio(request) {
      const api = client();
      const mimeType = baseMimeType(request.mimeType);
      const extension = MIME_EXTENSIONS[mimeType] ?? "webm";

      let text: string | undefined;
      try {
        const response = await api.audio.transcriptions.create({
          model: config.transcribeModel,
          file: await toFile(request.audio, `recording.${extension}`, { type: mimeType }),
        });
        text = response.text;
        config.onUsage?.({
          provider: config.provider,
          model: config.transcribeModel,
          operation: request.operation ?? "transcription",
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          audioSeconds: request.durationSeconds ?? 0,
        });
      } catch (err) {
        throw mapError(err, config.provider);
      }

      // An empty transcription is a valid result ("didn't catch anything"),
      // handled by audio-transcription.service.ts — not a provider failure.
      return text ?? "";
    },
  };
}
