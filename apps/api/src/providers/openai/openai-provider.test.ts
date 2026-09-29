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

  it("transcribes with gpt-transcribe (with the English+Hindi hint), strips mime parameters, and reports audio seconds", async () => {
    transcriptionsCreate.mockResolvedValue({ text: "remind me in 5 minutes" });
    const onUsage = vi.fn();
    const { createOpenAiProvider } = await import("./openai-provider.js");

    const text = await createOpenAiProvider({ apiKey: "sk-test", onUsage }).transcribeAudio({
      audio: Buffer.from("x"),
      mimeType: "audio/webm;codecs=opus",
      durationSeconds: 3.5,
      prompt: "Hinglish",
      languages: ["en", "hi"],
    });

    expect(text).toBe("remind me in 5 minutes");
    expect(transcriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-transcribe",
        prompt: "Hinglish",
        languages: ["en", "hi"],
        file: expect.objectContaining({ filename: "recording.webm", options: { type: "audio/webm" } }),
      }),
    );
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", model: "gpt-transcribe", audioSeconds: 3.5 }),
    );
  });

  it("doesn't send the languages hint to models that don't accept it", async () => {
    transcriptionsCreate.mockResolvedValue({ text: "hi" });
    const { createOpenAiProvider } = await import("./openai-provider.js");

    await createOpenAiProvider({ apiKey: "sk-test", transcribeModel: "gpt-4o-mini-transcribe" }).transcribeAudio({
      audio: Buffer.from("x"),
      mimeType: "audio/webm",
      languages: ["en", "hi"],
    });

    expect(transcriptionsCreate.mock.calls[0]![0]).not.toHaveProperty("languages");
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

describe("openai provider — streamChat", () => {
  beforeEach(() => {
    create.mockReset();
  });

  function streamOf(chunks: unknown[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    };
  }

  it("streams text deltas and reassembles tool calls sent in fragments", async () => {
    create.mockResolvedValue(
      streamOf([
        { choices: [{ delta: { content: "Let me " } }] },
        { choices: [{ delta: { content: "check." } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_calendar", arguments: '{"da' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "_events", arguments: 'ys":2}' } }] } }] },
        { choices: [], usage: { prompt_tokens: 500, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 400 } } },
      ]),
    );
    const onUsage = vi.fn();
    const deltas: string[] = [];
    const { createOpenAiProvider } = await import("./openai-provider.js");

    const result = await createOpenAiProvider({ apiKey: "sk-test", onUsage }).streamChat(
      {
        messages: [{ role: "user", content: "what's on tomorrow?" }],
        tools: [{ name: "get_calendar_events", description: "d", parameters: { type: "object" } }],
      },
      (d) => deltas.push(d),
    );

    expect(deltas).toEqual(["Let me ", "check."]);
    expect(result).toEqual({
      content: "Let me check.",
      toolCalls: [{ id: "call_1", name: "get_calendar_events", arguments: '{"days":2}' }],
      provider: "openai",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        stream_options: { include_usage: true },
        store: false,
        reasoning_effort: "none",
        tools: [expect.objectContaining({ type: "function" })],
      }),
    );
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "chat", inputTokens: 500, cachedInputTokens: 400, outputTokens: 20 }),
    );
  });

  it("sends assistant tool calls and tool results back in OpenAI's message format", async () => {
    create.mockResolvedValue(streamOf([{ choices: [{ delta: { content: "ok" } }] }]));
    const { createOpenAiProvider } = await import("./openai-provider.js");

    await createOpenAiProvider({ apiKey: "sk-test" }).streamChat(
      {
        messages: [
          { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "list_reminders", arguments: "{}" }] },
          { role: "tool", toolCallId: "c1", content: '{"reminders":[]}' },
        ],
        tools: [],
      },
      () => {},
    );

    expect(create.mock.calls[0]![0].messages).toEqual([
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "list_reminders", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: '{"reminders":[]}' },
    ]);
    expect(create.mock.calls[0]![0]).not.toHaveProperty("tools");
  });
});
