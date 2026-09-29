import {
  llmFailureDetail,
  llmFailureProvider,
  providerLabel,
} from "../providers/llm/llm-provider.js";

export type ProviderFailureCode = "not_configured" | "auth_rejected" | "model_unavailable" | "provider_error";

/**
 * User-facing wording for provider failures — shown as-is in the desktop
 * app, so it names the provider that actually failed (OpenAI or the Groq
 * fallback) and says what to do next. `feature` completes "to use …".
 * Provider diagnostics ("HTTP 429 rate_limit_exceeded") are appended where
 * they help, never raw provider messages.
 */
export function providerFailureMessage(code: ProviderFailureCode, err: unknown, feature: string): string {
  const label = providerLabel(llmFailureProvider(err));
  const detail = llmFailureDetail(err);
  const suffix = detail ? ` (${label}: ${detail})` : "";

  switch (code) {
    case "not_configured":
      return `Add your OpenAI API key in Settings to use ${feature}.`;
    case "auth_rejected":
      return `Your ${label} API key was rejected. Update it in Settings.`;
    case "model_unavailable":
      return `The ${label} model this app is set to use isn't available to your key. Choose another model in Settings.${suffix}`;
    case "provider_error":
      return `The AI service is busy or unreachable right now. Try again in a moment.${suffix}`;
  }
}
