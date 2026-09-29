import { describe, expect, it, vi } from "vitest";
import { createFallbackProvider, shouldFallBack } from "./fallback-provider.js";
import { LlmProviderError, type LlmProvider } from "./llm-provider.js";

const request = { instructions: "s", input: "u", schemaName: "x", jsonSchema: {} };

function provider(result: Promise<string>): LlmProvider {
  return {
    createStructuredCompletion: vi.fn().mockReturnValue(result),
    transcribeAudio: vi.fn().mockReturnValue(result),
  };
}

const outage = new LlmProviderError("unavailable", "down", "HTTP 503", "openai");

describe("shouldFallBack (ADR-006 rule)", () => {
  it("falls back on outage/overload and network failure", () => {
    expect(shouldFallBack(new LlmProviderError("unavailable", "x", "HTTP 429 rate_limit_exceeded", "openai"))).toBe(true);
    expect(shouldFallBack(outage)).toBe(true);
    expect(shouldFallBack(new LlmProviderError("failed", "x", "network error", "openai"))).toBe(true);
  });

  it("never hides configuration problems behind the fallback", () => {
    for (const kind of ["not_configured", "auth_rejected", "model_unavailable"] as const) {
      expect(shouldFallBack(new LlmProviderError(kind, "x", "HTTP 401", "openai"))).toBe(false);
    }
    expect(shouldFallBack(new LlmProviderError("failed", "x", "HTTP 400", "openai"))).toBe(false);
    expect(shouldFallBack(new Error("random"))).toBe(false);
  });
});

describe("createFallbackProvider", () => {
  it("uses the primary when it works", async () => {
    const primary = provider(Promise.resolve("primary"));
    const backup = provider(Promise.resolve("backup"));

    await expect(createFallbackProvider(primary, backup).createStructuredCompletion(request)).resolves.toBe("primary");
    expect(backup.createStructuredCompletion).not.toHaveBeenCalled();
  });

  it("switches to the backup on an outage — for chat and for transcription", async () => {
    const primary = provider(Promise.reject(outage));
    const backup = provider(Promise.resolve("backup"));
    const wrapped = createFallbackProvider(primary, backup);

    await expect(wrapped.createStructuredCompletion(request)).resolves.toBe("backup");
    await expect(wrapped.transcribeAudio({ audio: Buffer.from("a"), mimeType: "audio/webm" })).resolves.toBe("backup");
  });

  it("surfaces a rejected OpenAI key instead of silently using the backup", async () => {
    const rejected = new LlmProviderError("auth_rejected", "bad key", "HTTP 401", "openai");
    const primary = provider(Promise.reject(rejected));
    const backup = provider(Promise.resolve("backup"));

    await expect(createFallbackProvider(primary, backup).createStructuredCompletion(request)).rejects.toBe(rejected);
    expect(backup.createStructuredCompletion).not.toHaveBeenCalled();
  });

  it("returns the primary unchanged when there is no backup", () => {
    const primary = provider(Promise.resolve("primary"));
    expect(createFallbackProvider(primary, null)).toBe(primary);
  });
});
