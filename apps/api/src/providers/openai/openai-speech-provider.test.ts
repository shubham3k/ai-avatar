import { beforeEach, describe, expect, it, vi } from "vitest";

const speechCreate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({ audio: { speech: { create: speechCreate } } })),
}));

describe("OpenAI speech provider (M4)", () => {
  beforeEach(() => {
    speechCreate.mockReset();
  });

  it("requests MP3 from gpt-4o-mini-tts with the chosen voice and instructions, and reports estimated usage", async () => {
    speechCreate.mockResolvedValue({ arrayBuffer: async () => new TextEncoder().encode("mp3").buffer });
    const onUsage = vi.fn();
    const { createOpenAiSpeechProvider } = await import("./openai-speech-provider.js");

    const audio = await createOpenAiSpeechProvider({ apiKey: "sk-test", onUsage }).synthesizeSpeech({
      text: "Aapki meeting 3 baje hai.",
      voice: "marin",
      instructions: "warm",
    });

    expect(audio.toString()).toBe("mp3");
    expect(speechCreate).toHaveBeenCalledWith({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "Aapki meeting 3 baje hai.",
      response_format: "mp3",
      instructions: "warm",
    });
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", model: "gpt-4o-mini-tts", operation: "speech", audioSeconds: 2 }),
    );
  });

  it("redacts sensitive details before they reach OpenAI", async () => {
    speechCreate.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(1) });
    const { createOpenAiSpeechProvider } = await import("./openai-speech-provider.js");

    await createOpenAiSpeechProvider({ apiKey: "sk-test" }).synthesizeSpeech({
      text: "Your OTP is 482913",
      voice: "marin",
    });

    const input = speechCreate.mock.calls[0]![0].input as string;
    expect(input).not.toContain("482913");
  });

  it("fails as not_configured without an OpenAI key, and maps HTTP errors to typed ones", async () => {
    const { createOpenAiSpeechProvider } = await import("./openai-speech-provider.js");
    await expect(
      createOpenAiSpeechProvider({ apiKey: "" }).synthesizeSpeech({ text: "hi", voice: "marin" }),
    ).rejects.toMatchObject({ kind: "not_configured" });

    speechCreate.mockImplementation(async () => {
      throw Object.assign(new Error("nope"), { status: 401 });
    });
    await expect(
      createOpenAiSpeechProvider({ apiKey: "sk-bad" }).synthesizeSpeech({ text: "hi", voice: "marin" }),
    ).rejects.toMatchObject({ kind: "auth_rejected", provider: "openai" });
  });
});
