import { describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create } },
  })),
}));

describe("groq client", () => {
  it("throws a clear error when no API key is configured, without calling the SDK", async () => {
    const { createGroqProvider } = await import("./groq-client.js");
    const provider = createGroqProvider({ apiKey: "" });

    await expect(
      provider.createStructuredCompletion({
        instructions: "sys",
        input: "user",
        schemaName: "test_schema",
        jsonSchema: {},
      }),
    ).rejects.toThrow(/not configured/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("sends a Chat Completions request with structured JSON schema output", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '{"ok":true}' } }] });
    const { createGroqProvider } = await import("./groq-client.js");
    const provider = createGroqProvider({ apiKey: "test-key", model: "qwen/qwen3-32b" });

    const result = await provider.createStructuredCompletion({
      instructions: "system prompt",
      input: "user prompt",
      schemaName: "prioritization_result",
      jsonSchema: { type: "object" },
    });

    expect(result).toBe('{"ok":true}');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "qwen/qwen3-32b",
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "user prompt" },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "prioritization_result",
            schema: { type: "object" },
            strict: true,
          },
        },
      }),
    );
  });

  it("throws a safe error when the SDK reports an auth failure (401/403)", async () => {
    create.mockRejectedValue(Object.assign(new Error("Incorrect API key"), { status: 401 }));
    const { createGroqProvider } = await import("./groq-client.js");
    const provider = createGroqProvider({ apiKey: "bad-key" });

    await expect(
      provider.createStructuredCompletion({
        instructions: "s",
        input: "u",
        schemaName: "x",
        jsonSchema: {},
      }),
    ).rejects.toThrow(/rejected the request credentials/i);
  });

  it("throws a safe error on rate limit / 5xx failures", async () => {
    create.mockRejectedValue(Object.assign(new Error("Rate limited"), { status: 429 }));
    const { createGroqProvider } = await import("./groq-client.js");
    const provider = createGroqProvider({ apiKey: "key" });

    await expect(
      provider.createStructuredCompletion({
        instructions: "s",
        input: "u",
        schemaName: "x",
        jsonSchema: {},
      }),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it("never includes the raw provider error message in the thrown error", async () => {
    create.mockRejectedValue(new Error("diagnostic containing gsk-secretkey123"));
    const { createGroqProvider } = await import("./groq-client.js");
    const provider = createGroqProvider({ apiKey: "key" });

    await expect(
      provider.createStructuredCompletion({
        instructions: "s",
        input: "u",
        schemaName: "x",
        jsonSchema: {},
      }),
    ).rejects.not.toThrow(/gsk-secretkey123/);
  });

  it("throws when the SDK returns an empty response", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: "" } }] });
    const { createGroqProvider } = await import("./groq-client.js");
    const provider = createGroqProvider({ apiKey: "key" });

    await expect(
      provider.createStructuredCompletion({
        instructions: "s",
        input: "u",
        schemaName: "x",
        jsonSchema: {},
      }),
    ).rejects.toThrow(/empty response/i);
  });
});
