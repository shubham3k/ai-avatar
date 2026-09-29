import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const transcriptionsCreate = vi.fn();
const OpenAIConstructor = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation((options: unknown) => {
    OpenAIConstructor(options);
    return {
      chat: { completions: { create } },
      audio: { transcriptions: { create: transcriptionsCreate } },
    };
  }),
  toFile: vi.fn(async (data: unknown, filename: string, options: unknown) => ({ data, filename, options })),
}));

const request = { instructions: "sys", input: "user", schemaName: "s", jsonSchema: { type: "object" } };

describe("openai provider", () => {
  beforeEach(() => {
    create.mockReset();
    transcriptionsCreate.mockReset();
    OpenAIConstructor.mockReset();
  });

  it("uses OpenAI's own endpoint (no Groq base URL) and the gpt-6-luna default", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });
    const { createOpenAiProvider } = await import("./openai-provider.js");

    await createOpenAiProvider({ apiKey: "sk-test" }).createStructuredCompletion(request);

    expect(OpenAIConstructor).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-luna" }));
  });

  it("sends store:false (local-first) and reasoning_effort:none on every chat call", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });
    const { createOpenAiProvider } = await import("./openai-provider.js");

    await createOpenAiProvider({ apiKey: "sk-test", model: "gpt-5-nano" }).createStructuredCompletion(request);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5-nano",
        store: false,
        reasoning_effort: "none",
        max_completion_tokens: 800,
        response_format: expect.objectContaining({ type: "json_schema" }),
      }),
    );
  });

  it("reports token usage (never content) after a successful call", async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: '{"secret":"do not log"}' } }],
      usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1000 } },
    });
    const onUsage = vi.fn();
    const { createOpenAiProvider } = await import("./openai-provider.js");

    await createOpenAiProvider({ apiKey: "sk-test", onUsage }).createStructuredCompletion({
      ...request,
      operation: "reminder_parse",
    });

    expect(onUsage).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-6-luna",
      operation: "reminder_parse",
      inputTokens: 1200,
      cachedInputTokens: 1000,
      outputTokens: 80,
      audioSeconds: 0,
    });
  });

  it("transcribes with gpt-4o-mini-transcribe, strips mime parameters, and reports audio seconds", async () => {
    transcriptionsCreate.mockResolvedValue({ text: "remind me in 5 minutes" });
    const onUsage = vi.fn();
    const { createOpenAiProvider } = await import("./openai-provider.js");

    const text = await createOpenAiProvider({ apiKey: "sk-test", onUsage }).transcribeAudio({
      audio: Buffer.from("x"),
      mimeType: "audio/webm;codecs=opus",
      durationSeconds: 3.5,
    });

    expect(text).toBe("remind me in 5 minutes");
    expect(transcriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini-transcribe",
        file: expect.objectContaining({ filename: "recording.webm", options: { type: "audio/webm" } }),
      }),
    );
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", model: "gpt-4o-mini-transcribe", audioSeconds: 3.5 }),
    );
  });

  it("names OpenAI in its errors", async () => {
    create.mockRejectedValue(Object.assign(new Error("bad key"), { status: 401 }));
    const { createOpenAiProvider } = await import("./openai-provider.js");

    await expect(createOpenAiProvider({ apiKey: "sk-bad" }).createStructuredCompletion(request)).rejects.toMatchObject(
      { kind: "auth_rejected", provider: "openai", message: "OpenAI rejected the request credentials." },
    );
  });

  it("is 'not configured' without a key, without calling the SDK", async () => {
    const { createOpenAiProvider } = await import("./openai-provider.js");

    await expect(createOpenAiProvider({ apiKey: "" }).createStructuredCompletion(request)).rejects.toMatchObject({
      kind: "not_configured",
      provider: "openai",
    });
    expect(create).not.toHaveBeenCalled();
  });
});
