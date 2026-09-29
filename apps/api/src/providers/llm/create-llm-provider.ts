import { env } from "../../config/env.js";
import { createGroqProvider } from "../groq/groq-client.js";
import { createOpenAiProvider } from "../openai/openai-provider.js";
import { createFallbackProvider } from "./fallback-provider.js";
import type { LlmProvider, LlmUsageListener } from "./llm-provider.js";
import { withRedaction } from "./redacting-provider.js";

export interface LlmKeys {
  openaiApiKey?: string | undefined;
  groqApiKey?: string | undefined;
}

/**
 * Picks providers from the configured keys (ADR-006):
 * - OpenAI key set → OpenAI, with Groq as fallback when a Groq key is set too.
 * - Only a Groq key → Groq alone (installs from before ADR-006 keep working).
 * - Neither → the OpenAI provider, whose calls fail with "not configured",
 *   so the user is told to add an OpenAI key.
 */
export function createLlmProvider(options?: { keys?: LlmKeys; onUsage?: LlmUsageListener }): LlmProvider {
  const openaiApiKey = options?.keys ? options.keys.openaiApiKey : env.OPENAI_API_KEY;
  const groqApiKey = options?.keys ? options.keys.groqApiKey : env.GROQ_API_KEY;
  const usage = options?.onUsage ? { onUsage: options.onUsage } : {};

  const groq = groqApiKey ? createGroqProvider({ apiKey: groqApiKey, ...usage }) : null;
  if (!openaiApiKey && groq) return withRedaction(groq);

  // "" (not undefined) so an explicit "no OpenAI key" can't fall through to env.
  const openai = createOpenAiProvider({ apiKey: openaiApiKey ?? "", ...usage });
  // Redaction wraps everything, so neither the primary nor the fallback
  // ever receives unmasked sensitive details.
  return withRedaction(createFallbackProvider(openai, groq));
}
