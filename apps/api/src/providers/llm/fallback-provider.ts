import { LlmProviderError, type LlmProvider } from "./llm-provider.js";

/**
 * ADR-006 fallback rule: the backup takes over only when the primary is
 * down or overloaded — HTTP 429/5xx ("unavailable") or unreachable
 * ("network error"). Never for a missing/rejected key, a retired model, or
 * a bad request: those are configuration problems the user must see, not
 * something to paper over silently.
 */
export function shouldFallBack(err: unknown): boolean {
  if (!(err instanceof LlmProviderError)) return false;
  if (err.kind === "unavailable") return true;
  return err.kind === "failed" && err.detail === "network error";
}

/** Wraps a primary provider with an optional backup, per shouldFallBack. */
export function createFallbackProvider(primary: LlmProvider, fallback: LlmProvider | null): LlmProvider {
  if (!fallback) return primary;

  async function withFallback<T>(run: (provider: LlmProvider) => Promise<T>): Promise<T> {
    try {
      return await run(primary);
    } catch (err) {
      if (!shouldFallBack(err)) throw err;
      return run(fallback!);
    }
  }

  return {
    createStructuredCompletion: (request) => withFallback((p) => p.createStructuredCompletion(request)),
    transcribeAudio: (request) => withFallback((p) => p.transcribeAudio(request)),
    // A streamed reply can only switch providers before any text reached the
    // user — switching mid-sentence would splice two different answers.
    async streamChat(request, onTextDelta) {
      let streamed = false;
      try {
        return await primary.streamChat(request, (delta) => {
          streamed = true;
          onTextDelta(delta);
        });
      } catch (err) {
        if (streamed || !shouldFallBack(err)) throw err;
        return fallback.streamChat(request, onTextDelta);
      }
    },
  };
}
