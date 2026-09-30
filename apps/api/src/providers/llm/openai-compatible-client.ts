import OpenAI, { toFile } from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.js";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  LlmProviderError,
  PROVIDER_LABELS,
  type ChatTurnMessage,
  type LlmProvider,
  type LlmProviderName,
  type LlmUsageListener,
  type ToolCall,
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
  /** The transcription model accepts a `languages` hint (OpenAI gpt-transcribe). */
  transcribeLanguageHints?: boolean;
  /** Ask for token usage on the final streamed chunk (`stream_options.include_usage`) — OpenAI supports it. */
  streamUsage?: boolean;
  onUsage?: LlmUsageListener;
}

type OpenAiChatMessage = ChatCompletionMessageParam;

function toOpenAiMessages(messages: ChatTurnMessage[]): OpenAiChatMessage[] {
  return messages.map((message): OpenAiChatMessage => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    }
    return { role: message.role, content: message.content };
  });
}

interface StreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

/** OpenAI reports usage on `chunk.usage`; Groq on `chunk.x_groq.usage`. */
function chunkUsage(chunk: unknown): StreamUsage | null {
  if (!chunk || typeof chunk !== "object") return null;
  const record = chunk as { usage?: StreamUsage | null; x_groq?: { usage?: StreamUsage } };
  return record.usage ?? record.x_groq?.usage ?? null;
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
export function mapError(err: unknown, provider: LlmProviderName): LlmProviderError {
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
          ...(request.prompt ? { prompt: request.prompt } : {}),
          ...(request.languages && config.transcribeLanguageHints ? { languages: request.languages } : {}),
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

    async streamChat(request, onTextDelta) {
      const api = client();
      const body = {
        model: config.model,
        messages: toOpenAiMessages(request.messages),
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: "function" as const,
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
              })),
              ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
            }
          : {}),
        max_completion_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        stream: true,
        ...(config.streamUsage ? { stream_options: { include_usage: true } } : {}),
        ...config.extraChatParams,
      } as ChatCompletionCreateParamsStreaming;

      let content = "";
      const calls: ToolCall[] = [];
      let usage: StreamUsage | null = null;
      try {
        const stream = await api.chat.completions.create(body);
        for await (const chunk of stream) {
          usage = chunkUsage(chunk) ?? usage;
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            content += delta.content;
            onTextDelta(delta.content);
          }
          // Tool calls arrive in fragments, keyed by index.
          for (const fragment of delta.tool_calls ?? []) {
            const slot = (calls[fragment.index] ??= { id: "", name: "", arguments: "" });
            if (fragment.id) slot.id = fragment.id;
            if (fragment.function?.name) slot.name += fragment.function.name;
            if (fragment.function?.arguments) slot.arguments += fragment.function.arguments;
          }
        }
      } catch (err) {
        throw mapError(err, config.provider);
      }

      config.onUsage?.({
        provider: config.provider,
        model: config.model,
        operation: request.operation ?? "chat",
        inputTokens: usage?.prompt_tokens ?? 0,
        cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        audioSeconds: 0,
      });

      return {
        content,
        toolCalls: calls.filter((call) => call.name.length > 0),
        provider: config.provider,
      };
    },
  };
}
