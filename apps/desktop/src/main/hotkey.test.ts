import { describe, expect, it, vi } from "vitest";
import { createHotkeyManager, DEFAULT_CHAT_HOTKEY, DEFAULT_MAC_CHAT_HOTKEY, defaultChatHotkey, validateHotkey } from "./hotkey";

describe("validateHotkey (M4)", () => {
  it("accepts combinations with Ctrl or Alt, in canonical order", () => {
    expect(validateHotkey("Ctrl+Shift+Space", "win32")).toEqual({ ok: true, accelerator: "Ctrl+Shift+Space" });
    expect(validateHotkey("Shift+Alt+Z", "win32")).toEqual({ ok: true, accelerator: "Alt+Shift+Z" });
    expect(validateHotkey("Ctrl+Alt+F9", "win32")).toEqual({ ok: true, accelerator: "Ctrl+Alt+F9" });
  });

  it("refuses shortcuts Windows already uses", () => {
    expect(validateHotkey("Ctrl+Space", "win32")).toMatchObject({ ok: false, message: expect.stringMatching(/Windows/) });
    expect(validateHotkey("Alt+Space", "win32")).toMatchObject({ ok: false });
  });

  it("refuses combinations without Ctrl/Alt, unknown modifiers, and junk", () => {
    expect(validateHotkey("Shift+A", "win32")).toMatchObject({ ok: false, message: expect.stringMatching(/Ctrl or Alt/) });
    expect(validateHotkey("Space", "win32")).toMatchObject({ ok: false });
    expect(validateHotkey("Super+Ctrl+A", "win32")).toMatchObject({ ok: false });
    expect(validateHotkey("Ctrl+Ctrl+A", "win32")).toMatchObject({ ok: false });
    expect(validateHotkey("Ctrl+Shift+Tab", "win32")).toMatchObject({ ok: false });
    expect(validateHotkey(42, "win32")).toMatchObject({ ok: false });
  });
});

function fakeShortcuts(taken: string[] = []) {
  const active = new Map<string, () => void>();
  return {
    active,
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (taken.includes(accelerator) || active.has(accelerator)) return false;
      active.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      active.delete(accelerator);
    }),
  };
}

describe("createHotkeyManager", () => {
  it("registers the saved shortcut, falling back to the default when the saved one is invalid", () => {
    const shortcuts = fakeShortcuts();
    const onPress = vi.fn();
    const manager = createHotkeyManager({ globalShortcut: shortcuts, initial: "Ctrl+Space", onPress, platform: "win32" });
    expect(manager.current()).toBe(DEFAULT_CHAT_HOTKEY);
    shortcuts.active.get(DEFAULT_CHAT_HOTKEY)!();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("changes shortcut, releasing the old one", () => {
    const shortcuts = fakeShortcuts();
    const manager = createHotkeyManager({ globalShortcut: shortcuts, initial: DEFAULT_CHAT_HOTKEY, onPress: vi.fn(), platform: "win32" });
    expect(manager.change("Alt+Z")).toEqual({ ok: true, accelerator: "Alt+Z" });
    expect(manager.current()).toBe("Alt+Z");
    expect([...shortcuts.active.keys()]).toEqual(["Alt+Z"]);
  });

  it("keeps the old shortcut when the new one belongs to another app", () => {
    const shortcuts = fakeShortcuts(["Ctrl+Alt+Z"]);
    const manager = createHotkeyManager({ globalShortcut: shortcuts, initial: DEFAULT_CHAT_HOTKEY, onPress: vi.fn(), platform: "win32" });
    expect(manager.change("Ctrl+Alt+Z")).toMatchObject({ ok: false, message: expect.stringMatching(/another app/) });
    expect(manager.current()).toBe(DEFAULT_CHAT_HOTKEY);
    expect([...shortcuts.active.keys()]).toEqual([DEFAULT_CHAT_HOTKEY]);
  });

  it("reports (not throws) when even the startup shortcut is taken", () => {
    const warn = vi.fn();
    const manager = createHotkeyManager({
      globalShortcut: fakeShortcuts([DEFAULT_CHAT_HOTKEY]),
      initial: DEFAULT_CHAT_HOTKEY,
      onPress: vi.fn(),
      logger: { warn },
      platform: "win32",
    });
    expect(manager.current()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe("macOS shortcuts (ADR-007)", () => {
  it("defaults to Cmd+Shift+Space on a Mac and keeps Ctrl+Shift+Space on Windows", () => {
    expect(defaultChatHotkey("darwin")).toBe("Cmd+Shift+Space");
    expect(defaultChatHotkey("win32")).toBe("Ctrl+Shift+Space");
  });

  it("accepts Cmd in canonical order and refuses Spotlight, input-source, emoji, quit and screenshot combos", () => {
    expect(validateHotkey("Shift+Cmd+Space", "darwin")).toEqual({ ok: true, accelerator: "Cmd+Shift+Space" });
    expect(validateHotkey("Alt+Cmd+K", "darwin")).toEqual({ ok: true, accelerator: "Cmd+Alt+K" });
    expect(validateHotkey("Ctrl+Alt+Z", "darwin")).toEqual({ ok: true, accelerator: "Ctrl+Alt+Z" });
    for (const combo of ["Cmd+Space", "Ctrl+Space", "Ctrl+Cmd+Space", "Cmd+Q", "Cmd+Shift+4", "Cmd+Alt+Space"]) {
      expect(validateHotkey(combo, "darwin")).toMatchObject({ ok: false, message: expect.stringMatching(/macOS/) });
    }
    expect(validateHotkey("Shift+A", "darwin")).toMatchObject({ ok: false, message: expect.stringMatching(/Cmd, Control, or Option/) });
  });

  it("never accepts Cmd on Windows", () => {
    expect(validateHotkey("Cmd+Shift+Space", "win32")).toMatchObject({ ok: false });
  });

  it("falls back to the Mac default when a saved shortcut is invalid there", () => {
    const shortcuts = fakeShortcuts();
    const manager = createHotkeyManager({ globalShortcut: shortcuts, initial: "Cmd+Space", onPress: vi.fn(), platform: "darwin" });
    expect(manager.current()).toBe(DEFAULT_MAC_CHAT_HOTKEY);
  });
});
