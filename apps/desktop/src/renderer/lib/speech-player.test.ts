import { describe, expect, it, vi } from "vitest";
import { pickLocalVoice } from "./speech-output";
import { createSpeaker, type SpeakerSettings, type SpeechOutput } from "./speech-player";

/** Records what was played; each MP3 playback finishes only when the test says so. */
function fakeOutput(synth: (text: string) => Promise<string> = async (text) => `mp3:${text}`) {
  const played: string[] = [];
  const pending: (() => void)[] = [];
  const output: SpeechOutput = {
    synthesize: vi.fn((text: string) => synth(text)),
    playMp3: vi.fn(
      (audio: string) =>
        new Promise<void>((resolve) => {
          played.push(audio);
          pending.push(resolve);
        }),
    ),
    speakLocally: vi.fn(async (text: string) => {
      played.push(`local:${text}`);
    }),
    stopAll: vi.fn(() => pending.splice(0).forEach((finish) => finish())),
  };
  const finishCurrent = async () => {
    pending.shift()?.();
    await flush();
  };
  return { output, played, finishCurrent };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const openai: SpeakerSettings = { engine: "openai", openaiVoice: "marin", windowsVoice: null };

describe("speaker (M4)", () => {
  it("prefetches every chunk and plays them in order", async () => {
    const { output, played, finishCurrent } = fakeOutput();
    const onSpeakingChange = vi.fn();
    const speaker = createSpeaker({ output, getSettings: () => openai, onSpeakingChange });

    speaker.say("One.");
    speaker.say("Two.");
    expect(output.synthesize).toHaveBeenCalledTimes(2);
    await flush();
    expect(played).toEqual(["mp3:One."]);
    await finishCurrent();
    expect(played).toEqual(["mp3:One.", "mp3:Two."]);
    await finishCurrent();
    expect(onSpeakingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("stop() silences her immediately and drops the queue", async () => {
    const { output, played } = fakeOutput();
    const speaker = createSpeaker({ output, getSettings: () => openai });
    speaker.say("One.");
    speaker.say("Two.");
    await flush();

    speaker.stop();
    await flush();

    expect(output.stopAll).toHaveBeenCalled();
    expect(played).toEqual(["mp3:One."]);
    expect(speaker.isSpeaking()).toBe(false);
  });

  it("falls back to a Windows voice when OpenAI fails, and says why once", async () => {
    const { output, played } = fakeOutput(async () => {
      throw new Error("Add your OpenAI API key in Settings to use Zara's OpenAI voice.");
    });
    const onNotice = vi.fn();
    const speaker = createSpeaker({ output, getSettings: () => openai, onNotice });

    speaker.say("One.");
    speaker.say("Two.");
    await flush();
    await flush();

    expect(played).toEqual(["local:One.", "local:Two."]);
    expect(onNotice).toHaveBeenCalledOnce();
    expect(onNotice.mock.calls[0]![0]).toMatch(/Windows voice/);
  });

  it("uses only the Windows voice when chosen, and nothing when voice is off", async () => {
    const windows = fakeOutput();
    createSpeaker({ output: windows.output, getSettings: () => ({ ...openai, engine: "windows" }) }).say("Hi there.");
    await flush();
    expect(windows.output.synthesize).not.toHaveBeenCalled();
    expect(windows.played).toEqual(["local:Hi there."]);

    const off = fakeOutput();
    createSpeaker({ output: off.output, getSettings: () => ({ ...openai, engine: "off" }) }).say("Hi there.");
    await flush();
    expect(off.played).toEqual([]);
  });
});

describe("pickLocalVoice", () => {
  const voices = [
    { name: "Microsoft Zira - English (United States)", lang: "en-US" },
    { name: "Microsoft Kalpana - Hindi (India)", lang: "hi-IN" },
  ];

  it("uses a Hindi voice for Devanagari text, the chosen voice otherwise", () => {
    expect(pickLocalVoice(voices, "आपकी मीटिंग तीन बजे है", voices[0]!.name)?.lang).toBe("hi-IN");
    expect(pickLocalVoice(voices, "Aapki meeting 3 baje hai", voices[0]!.name)?.lang).toBe("en-US");
    expect(pickLocalVoice(voices, "Hello", null)).toBeNull();
  });
});
