import { describe, expect, it, vi } from "vitest";
import { createHotkeyManager, DEFAULT_CHAT_HOTKEY, validateHotkey } from "./hotkey";

describe("validateHotkey (M4)", () => {
  it("accepts combinations with Ctrl or Alt, in canonical order", () => {
    expect(validateHotkey("Ctrl+Shift+Space")).toEqual({ ok: true, accelerator: "Ctrl+Shift+Space" });
    expect(validateHotkey("Shift+Alt+Z")).toEqual({ ok: true, accelerator: "Alt+Shift+Z" });
    expect(validateHotkey("Ctrl+Alt+F9")).toEqual({ ok: true, accelerator: "Ctrl+Alt+F9" });
  });

  it("refuses shortcuts Windows already uses", () => {
    expect(validateHotkey("Ctrl+Space")).toMatchObject({ ok: false, message: expect.stringMatching(/Windows/) });
    expect(validateHotkey("Alt+Space")).toMatchObject({ ok: false });
  });

  it("refuses combinations without Ctrl/Alt, unknown modifiers, and junk", () => {
    expect(validateHotkey("Shift+A")).toMatchObject({ ok: false, message: expect.stringMatching(/Ctrl or Alt/) });
    expect(validateHotkey("Space")).toMatchObject({ ok: false });
    expect(validateHotkey("Super+Ctrl+A")).toMatchObject({ ok: false });
    expect(validateHotkey("Ctrl+Ctrl+A")).toMatchObject({ ok: false });
    expect(validateHotkey("Ctrl+Shift+Tab")).toMatchObject({ ok: false });
    expect(validateHotkey(42)).toMatchObject({ ok: false });
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
    const manager = createHotkeyManager({ globalShortcut: shortcuts, initial: "Ctrl+Space", onPress });
    expect(manager.current()).toBe(DEFAULT_CHAT_HOTKEY);
    shortcuts.active.get(DEFAULT_CHAT_HOTKEY)!();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("changes shortcut, releasing the old one", () => {
    const shortcuts = fakeShortcuts();
    const manager = createHotkeyManager({ globalShortcut: shortcuts, initial: DEFAULT_CHAT_HOTKEY, onPress: vi.fn() });
    expect(manager.change("Alt+Z")).toEqual({ ok: true, accelerator: "Alt+Z" });
    expect(manager.current()).toBe("Alt+Z");
    expect([...shortcuts.active.keys()]).toEqual(["Alt+Z"]);
  });

  it("keeps the old shortcut when the new one belongs to another app", () => {
    const shortcuts = fakeShortcuts(["Ctrl+Alt+Z"]);
    const manager = createHotkeyManager({ globalShortcut: shortcuts, initial: DEFAULT_CHAT_HOTKEY, onPress: vi.fn() });
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
    });
    expect(manager.current()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
