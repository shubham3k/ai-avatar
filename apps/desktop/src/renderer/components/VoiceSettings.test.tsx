import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVoicePreferences } from "../lib/preferences";
import { acceleratorFromKeyEvent, VOICE_PREVIEW_TEXT, VoiceSettings } from "./VoiceSettings";

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    setTimeout(() => this.onended?.(new Event("ended")), 0);
    return Promise.resolve();
  });
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  // Unmount first, so stopping speech on unmount still sees the media stubs.
  cleanup();
  vi.restoreAllMocks();
  delete (window as { desktopAPI?: unknown }).desktopAPI;
});

function installBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    getSettings: vi.fn().mockResolvedValue({ chatHotkey: "Ctrl+Shift+Space" }),
    saveChatHotkey: vi.fn(async (accelerator: string) => ({ ok: true, accelerator })),
    chatSpeak: vi.fn().mockResolvedValue({ ok: true, value: "bXAz" }),
    ...overrides,
  };
  window.desktopAPI = bridge as unknown as NonNullable<Window["desktopAPI"]>;
  return bridge;
}

describe("acceleratorFromKeyEvent", () => {
  it("builds Electron accelerators and waits while only modifiers are held", () => {
    expect(acceleratorFromKeyEvent({ code: "Space", ctrlKey: true, altKey: false, shiftKey: true })).toBe("Ctrl+Shift+Space");
    expect(acceleratorFromKeyEvent({ code: "KeyZ", ctrlKey: false, altKey: true, shiftKey: false })).toBe("Alt+Z");
    expect(acceleratorFromKeyEvent({ code: "F9", ctrlKey: true, altKey: false, shiftKey: false })).toBe("Ctrl+F9");
    expect(acceleratorFromKeyEvent({ code: "ShiftLeft", ctrlKey: false, altKey: false, shiftKey: true })).toBeNull();
  });

  it("puts Cmd first on a Mac (ADR-007)", () => {
    expect(acceleratorFromKeyEvent({ code: "Space", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe("Cmd+Shift+Space");
  });
});

describe("Settings → Voice on a Mac (ADR-007)", () => {
  it("says Mac voice and Cmd instead of Windows wording", async () => {
    installBridge({ platform: "darwin", getSettings: vi.fn().mockResolvedValue({ chatHotkey: "Cmd+Shift+Space" }) });
    render(<VoiceSettings />);
    expect(await screen.findByDisplayValue("Cmd+Shift+Space")).toBeInTheDocument();
    expect(screen.getByText(/needs Cmd, Control, or Option/)).toBeInTheDocument();
    expect(screen.getAllByText(/Mac voice/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Windows voice/)).toBeNull();
  });
});

describe("Settings → Voice (ADR-006 M4)", () => {
  it("shows the current shortcut and changes it by pressing a new combination", async () => {
    const bridge = installBridge();
    render(<VoiceSettings />);
    const box = screen.getByLabelText("Shortcut to open Zara");
    await waitFor(() => expect(box).toHaveValue("Ctrl+Shift+Space"));

    fireEvent.keyDown(box, { code: "KeyZ", key: "z", altKey: true });

    await waitFor(() => expect(box).toHaveValue("Alt+Z"));
    expect(bridge.saveChatHotkey).toHaveBeenCalledWith("Alt+Z");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("explains a refused shortcut", async () => {
    installBridge({
      saveChatHotkey: vi.fn().mockResolvedValue({ ok: false, message: "Ctrl+Space is used by Windows — choose another." }),
    });
    render(<VoiceSettings />);
    fireEvent.keyDown(screen.getByLabelText("Shortcut to open Zara"), { code: "Space", key: " ", ctrlKey: true });
    expect(await screen.findByRole("status")).toHaveTextContent("used by Windows");
  });

  it("defaults to OpenAI's marin voice and click-to-talk, and remembers changes", () => {
    installBridge();
    render(<VoiceSettings />);
    expect(screen.getByLabelText("OpenAI voice")).toHaveValue("marin");
    expect(screen.getByRole("radio", { name: /Click to talk/ })).toBeChecked();

    fireEvent.change(screen.getByLabelText("OpenAI voice"), { target: { value: "coral" } });
    fireEvent.click(screen.getByRole("radio", { name: /Hands-free/ }));

    expect(getVoicePreferences()).toMatchObject({ openaiVoice: "coral", inputMode: "handsfree" });
  });

  it("previews the chosen voice with an English + Hinglish line", async () => {
    const bridge = installBridge();
    render(<VoiceSettings />);
    fireEvent.change(screen.getByLabelText("OpenAI voice"), { target: { value: "nova" } });

    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));

    await waitFor(() => expect(bridge.chatSpeak).toHaveBeenCalledWith(VOICE_PREVIEW_TEXT, "nova"));
  });

  it("writes Hindi in Roman letters (Hinglish) by default; Devanagari is a choice", () => {
    installBridge();
    render(<VoiceSettings />);
    expect(screen.getByLabelText("Write my Hindi as")).toHaveValue("latin");
    fireEvent.change(screen.getByLabelText("Write my Hindi as"), { target: { value: "devanagari" } });
    expect(getVoicePreferences().hindiScript).toBe("devanagari");
  });

  it("hides the voice pickers when voice is off", () => {
    installBridge();
    render(<VoiceSettings />);
    fireEvent.click(screen.getByRole("radio", { name: /^Off/ }));
    expect(screen.queryByLabelText("OpenAI voice")).toBeNull();
    expect(screen.queryByRole("button", { name: /Preview/ })).toBeNull();
    expect(getVoicePreferences().engine).toBe("off");
  });
});
