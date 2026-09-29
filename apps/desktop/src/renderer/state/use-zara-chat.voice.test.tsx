import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setVoicePreferences } from "../lib/preferences";
import { useZaraChat } from "./use-zara-chat";

/** chatSend double: plays Zara's streamed reply, then resolves like the real IPC call. */
function chatSendReplying(reply: string[]) {
  return vi.fn(async (_id: string | null, _text: string, onEvent: (e: unknown) => void) => {
    for (const text of reply) onEvent({ type: "delta", text });
    onEvent({ type: "done", message: { id: "m2", role: "assistant", content: reply.join(""), provider: "openai" } });
    return { ok: true, value: null };
  });
}

let play: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  // jsdom has no media playback; each clip "plays" instantly.
  play = vi.fn(function (this: HTMLMediaElement) {
    setTimeout(() => this.onended?.(new Event("ended")), 0);
    return Promise.resolve();
  });
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(play as never);
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  // Unmount first, so stopping speech on unmount still sees the media stubs.
  cleanup();
  vi.restoreAllMocks();
  delete (window as { desktopAPI?: unknown }).desktopAPI;
});

describe("Zara speaks when spoken to (ADR-006 M4)", () => {
  it("reads a reply to a spoken message aloud, sentence by sentence, in the chosen voice", async () => {
    setVoicePreferences({ engine: "openai", openaiVoice: "cedar" });
    const chatSend = chatSendReplying(["Aapki aaj teen meetings hain. ", "Pehli meeting das baje hai."]);
    const chatSpeak = vi.fn().mockResolvedValue({ ok: true, value: "bXAz" });
    window.desktopAPI = { chatSend, chatSpeak } as unknown as NonNullable<Window["desktopAPI"]>;
    const { result } = renderHook(() => useZaraChat());

    await act(() => result.current.send("aaj ka schedule kya hai", { spoken: true }));

    expect(chatSend).toHaveBeenCalledWith(null, "aaj ka schedule kya hai", expect.any(Function), { spoken: true });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(chatSpeak.mock.calls).toEqual([
      ["Aapki aaj teen meetings hain.", "cedar"],
      ["Pehli meeting das baje hai.", "cedar"],
    ]);
    await waitFor(() => expect(result.current.speaking).toBe(false));
  });

  it("stays silent for typed messages", async () => {
    const chatSpeak = vi.fn();
    window.desktopAPI = {
      chatSend: chatSendReplying(["You have three meetings today."]),
      chatSpeak,
    } as unknown as NonNullable<Window["desktopAPI"]>;
    const { result } = renderHook(() => useZaraChat());

    await act(() => result.current.send("what's on today?"));

    expect(chatSpeak).not.toHaveBeenCalled();
    expect(result.current.speaking).toBe(false);
  });

  it("stopSpeaking interrupts her immediately", async () => {
    let finishFirst: (() => void) | null = null;
    play.mockImplementation(function (this: HTMLMediaElement) {
      finishFirst = () => this.onended?.(new Event("ended"));
      return Promise.resolve();
    });
    const chatSpeak = vi.fn().mockResolvedValue({ ok: true, value: "bXAz" });
    window.desktopAPI = {
      chatSend: chatSendReplying(["This is the first sentence of it. ", "And this is the second one here."]),
      chatSpeak,
    } as unknown as NonNullable<Window["desktopAPI"]>;
    const { result } = renderHook(() => useZaraChat());

    await act(() => result.current.send("tell me", { spoken: true }));
    await waitFor(() => expect(result.current.speaking).toBe(true));
    act(() => result.current.stopSpeaking());

    expect(result.current.speaking).toBe(false);
    expect(finishFirst).not.toBeNull();
    // Only the first chunk ever started playing.
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("falls back to a Windows voice with a note when OpenAI's voice isn't available", async () => {
    const speak = vi.fn((utterance: { onend?: () => void }) => setTimeout(() => utterance.onend?.(), 0));
    Object.assign(window, {
      speechSynthesis: { speak, cancel: vi.fn(), getVoices: () => [{ name: "Zira", lang: "en-US" }] },
      SpeechSynthesisUtterance: class {
        text: string;
        onend?: () => void;
        constructor(text: string) {
          this.text = text;
        }
      },
    });
    window.desktopAPI = {
      chatSend: chatSendReplying(["Your reminder is set for four."]),
      chatSpeak: vi.fn().mockResolvedValue({
        ok: false,
        message: "Add your OpenAI API key in Settings to use Zara's OpenAI voice.",
      }),
    } as unknown as NonNullable<Window["desktopAPI"]>;
    const { result } = renderHook(() => useZaraChat());

    await act(() => result.current.send("remind me at 4", { spoken: true }));

    await waitFor(() => expect(speak).toHaveBeenCalledOnce());
    expect(result.current.voiceNotice).toMatch(/Using a Windows voice instead/);
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  });
});
