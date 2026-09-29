import { describe, expect, it, vi } from "vitest";
import { createAudioTranscriptionService } from "./audio-transcription.service.js";
import type { GroqProvider } from "../providers/groq/groq-client.js";

function makeProvider(overrides: Partial<GroqProvider> = {}): GroqProvider {
  return {
    createStructuredCompletion: vi.fn(),
    transcribeAudio: vi.fn().mockResolvedValue("remind me to drink water at 4pm"),
    ...overrides,
  };
}

describe("audio transcription service", () => {
  it("returns the trimmed transcribed text", async () => {
    const provider = makeProvider({
      transcribeAudio: vi.fn().mockResolvedValue("  remind me to drink water at 4pm  "),
    });
    const service = createAudioTranscriptionService({ provider });

    const result = await service.transcribe(Buffer.from("audio"), "audio/webm");

    expect(result).toEqual({ ok: true, text: "remind me to drink water at 4pm" });
  });

  it("passes the audio buffer and mime type straight through", async () => {
    const provider = makeProvider();
    const service = createAudioTranscriptionService({ provider });
    const buffer = Buffer.from("audio-bytes");

    await service.transcribe(buffer, "audio/webm", 4.2);

    expect(provider.transcribeAudio).toHaveBeenCalledWith({
      audio: buffer,
      mimeType: "audio/webm",
      operation: "transcription",
      durationSeconds: 4.2,
    });
  });

  it("returns not_configured when Groq isn't configured", async () => {
    const provider = makeProvider({
      transcribeAudio: vi.fn().mockRejectedValue(new Error("Groq is not configured. Set GROQ_API_KEY.")),
    });
    const service = createAudioTranscriptionService({ provider });

    const result = await service.transcribe(Buffer.from("audio"), "audio/webm");

    expect(result).toMatchObject({ ok: false, code: "not_configured" });
  });

  it("returns provider_error for any other transcription failure", async () => {
    const provider = makeProvider({ transcribeAudio: vi.fn().mockRejectedValue(new Error("boom")) });
    const service = createAudioTranscriptionService({ provider });

    const result = await service.transcribe(Buffer.from("audio"), "audio/webm");

    expect(result).toMatchObject({ ok: false, code: "provider_error" });
  });

  it("returns empty when the transcription is blank", async () => {
    const provider = makeProvider({ transcribeAudio: vi.fn().mockResolvedValue("   ") });
    const service = createAudioTranscriptionService({ provider });

    const result = await service.transcribe(Buffer.from("audio"), "audio/webm");

    expect(result).toMatchObject({ ok: false, code: "empty" });
  });
});
