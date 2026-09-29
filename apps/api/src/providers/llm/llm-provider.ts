/**
 * Provider-neutral contract for the LLM calls the app makes (ADR-006).
 * OpenAI is the primary provider and Groq the optional fallback; both are
 * OpenAI-compatible, so one client implementation serves both
 * (openai-compatible-client.ts). Callers only ever see this interface.
 */

export type LlmProviderName = "openai" | "groq";

export const PROVIDER_LABELS: Record<LlmProviderName, string> = {
  openai: "OpenAI",
  groq: "Groq",
};

/** What a call was for — recorded with its usage so "usage this month" can be broken down. */
export type LlmOperation = "reminder_parse" | "prioritization" | "transcription" | "chat" | "other";

export interface StructuredCompletionRequest {
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Upper bound on the reply length; defaults to DEFAULT_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
  operation?: LlmOperation;
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
  /** e.g. "audio/webm" — used to pick a matching filename extension for the upload. */
  mimeType: string;
  /** Length of the clip as measured by the recorder — transcription is billed per minute. */
  durationSeconds?: number;
  operation?: LlmOperation;
}

/** A tool the model may call — JSON Schema parameters; arguments are Zod-validated before anything runs. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text from the model — untrusted until validated. */
  arguments: string;
}

export type ChatTurnMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ChatRequest {
  messages: ChatTurnMessage[];
  tools: ToolDefinition[];
  maxOutputTokens?: number;
  operation?: LlmOperation;
}

export interface ChatResult {
  /** Text the model produced this turn (already streamed through onTextDelta). */
  content: string;
  /** Tools the model asked to call; empty when this is a final answer. */
  toolCalls: ToolCall[];
  /** Which provider answered — replies from the fallback are labelled for the user. */
  provider: LlmProviderName;
}

export interface LlmProvider {
  /** Returns the raw JSON text produced by the model — not yet parsed/validated. */
  createStructuredCompletion(request: StructuredCompletionRequest): Promise<string>;
  /** Returns the raw transcribed text. */
  transcribeAudio(request: TranscriptionRequest): Promise<string>;
  /** One model turn with tools, streaming text as it's generated (ADR-006 chat). */
  streamChat(request: ChatRequest, onTextDelta: (delta: string) => void): Promise<ChatResult>;
}

/** One successful provider call, reported for usage tracking. Never contains content. */
export interface LlmUsageEvent {
  provider: LlmProviderName;
  model: string;
  operation: LlmOperation;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  audioSeconds: number;
}

export type LlmUsageListener = (event: LlmUsageEvent) => void;

export type LlmFailureKind =
  | "not_configured"
  | "auth_rejected"
  | "model_unavailable"
  | "unavailable"
  | "failed";

/** Typed provider failure, so callers can tell a bad API key apart from a transient outage without matching on message text. */
export class LlmProviderError extends Error {
  readonly kind: LlmFailureKind;
  /**
   * Short, safe diagnostic — HTTP status plus the provider's machine-readable
   * error code, e.g. "HTTP 429 rate_limit_exceeded" or "network error".
   * Never the raw provider message or payload. Surfaced to the user so a
   * failure in the packaged app (which has no log file) can be diagnosed
   * from the screen alone.
   */
  readonly detail: string | null;
  /** Which provider failed — null for errors not tied to one (e.g. test doubles). */
  readonly provider: LlmProviderName | null;

  constructor(
    kind: LlmFailureKind,
    message: string,
    detail: string | null = null,
    provider: LlmProviderName | null = null,
  ) {
    super(message);
    this.name = "LlmProviderError";
    this.kind = kind;
    this.detail = detail;
    this.provider = provider;
  }
}

/** Classifies anything a provider call threw. Falls back to "not configured" message matching for plain Errors (e.g. test doubles). */
export function classifyLlmFailure(err: unknown): LlmFailureKind {
  if (err instanceof LlmProviderError) return err.kind;
  if (err instanceof Error && /not configured/i.test(err.message)) return "not_configured";
  return "failed";
}

export function llmFailureDetail(err: unknown): string | null {
  return err instanceof LlmProviderError ? err.detail : null;
}

export function llmFailureProvider(err: unknown): LlmProviderName | null {
  return err instanceof LlmProviderError ? err.provider : null;
}

/** "OpenAI" / "Groq", or a neutral label when the failing provider is unknown. */
export function providerLabel(provider: LlmProviderName | null): string {
  return provider ? PROVIDER_LABELS[provider] : "AI provider";
}
