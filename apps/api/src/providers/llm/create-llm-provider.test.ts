import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiCall = vi.fn();
const groqCall = vi.fn();

vi.mock("../openai/openai-provider.js", () => ({
  createOpenAiProvider: vi.fn((options: { apiKey?: string }) => ({
    createStructuredCompletion: () => openaiCall(options.apiKey),
    transcribeAudio: vi.fn(),
  })),
}));
vi.mock("../groq/groq-client.js", () => ({
  createGroqProvider: vi.fn((options: { apiKey?: string }) => ({
    createStructuredCompletion: () => groqCall(options.apiKey),
    transcribeAudio: vi.fn(),
  })),
}));

const request = { instructions: "s", input: "u", schemaName: "x", jsonSchema: {} };

describe("createLlmProvider — which provider answers (ADR-006)", () => {
  beforeEach(() => {
    openaiCall.mockReset().mockResolvedValue("openai");
    groqCall.mockReset().mockResolvedValue("groq");
  });

  it("uses OpenAI when an OpenAI key is set", async () => {
    const { createLlmProvider } = await import("./create-llm-provider.js");
    const provider = createLlmProvider({ keys: { openaiApiKey: "sk-1", groqApiKey: "gsk-1" } });

    await expect(provider.createStructuredCompletion(request)).resolves.toBe("openai");
    expect(openaiCall).toHaveBeenCalledWith("sk-1");
  });

  it("falls back to Groq on an OpenAI outage when a Groq key is set", async () => {
    const { LlmProviderError } = await import("./llm-provider.js");
    openaiCall.mockRejectedValue(new LlmProviderError("unavailable", "down", "HTTP 503", "openai"));
    const { createLlmProvider } = await import("./create-llm-provider.js");

    const provider = createLlmProvider({ keys: { openaiApiKey: "sk-1", groqApiKey: "gsk-1" } });

    await expect(provider.createStructuredCompletion(request)).resolves.toBe("groq");
  });

  it("keeps pre-ADR-006 installs working: only a Groq key → Groq alone", async () => {
    const { createLlmProvider } = await import("./create-llm-provider.js");

    await expect(
      createLlmProvider({ keys: { groqApiKey: "gsk-1" } }).createStructuredCompletion(request),
    ).resolves.toBe("groq");
    expect(openaiCall).not.toHaveBeenCalled();
  });

  it("with no keys, asks OpenAI with an empty key (so the user is told to add one) — never env's", async () => {
    const { createLlmProvider } = await import("./create-llm-provider.js");

    await createLlmProvider({ keys: {} }).createStructuredCompletion(request);

    expect(openaiCall).toHaveBeenCalledWith("");
    expect(groqCall).not.toHaveBeenCalled();
  });
});
