/**
 * ADR-006 §5 (M4): the global shortcut that opens Zara from anywhere.
 * Windows: Ctrl+Space and Alt+Space are refused — Windows uses them for
 * switching input language and for the window menu. macOS (ADR-007):
 * Cmd+Shift+Space by default; Spotlight, input-source, emoji, app-switcher,
 * quit/hide and screenshot combos are refused.
 */
export const DEFAULT_CHAT_HOTKEY = "Ctrl+Shift+Space";
export const DEFAULT_MAC_CHAT_HOTKEY = "Cmd+Shift+Space";

export function defaultChatHotkey(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? DEFAULT_MAC_CHAT_HOTKEY : DEFAULT_CHAT_HOTKEY;
}

const WINDOWS_MODIFIERS = ["Ctrl", "Alt", "Shift"] as const;
/** Electron accelerator order on macOS: Cmd first. */
const MAC_MODIFIERS = ["Cmd", "Ctrl", "Alt", "Shift"] as const;
const WINDOWS_RESERVED = new Set(["Ctrl+Space", "Alt+Space", "Alt+Tab", "Alt+F4", "Ctrl+Alt+Delete", "Ctrl+Shift+Escape"]);
const MAC_RESERVED = new Set([
  "Cmd+Space", // Spotlight
  "Cmd+Alt+Space", // Finder search
  "Ctrl+Space", // input source
  "Ctrl+Alt+Space",
  "Cmd+Ctrl+Space", // emoji picker
  "Cmd+Tab",
  "Cmd+Q",
  "Cmd+W",
  "Cmd+H",
  "Cmd+Alt+H",
  "Cmd+M",
  "Cmd+Alt+Escape", // force quit
  "Cmd+Ctrl+Q", // lock screen
  "Cmd+Shift+3",
  "Cmd+Shift+4",
  "Cmd+Shift+5",
]);

/** Keys allowed after the modifiers: letters, digits, F1–F24, Space, and a few named keys. */
const KEY_PATTERN = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Backspace|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|`|-|=|\[|\]|;|'|,|\.|\/|\\)$/;

export type HotkeyValidation = { ok: true; accelerator: string } | { ok: false; message: string };

/**
 * Checks an Electron accelerator from the renderer (e.g. "Ctrl+Shift+Space",
 * or "Cmd+Shift+Space" on a Mac) and returns it in canonical modifier
 * order. Needs Ctrl or Alt (or Cmd on a Mac) so ordinary typing can never
 * trigger it.
 */
export function validateHotkey(value: unknown, platform: NodeJS.Platform = process.platform): HotkeyValidation {
  const mac = platform === "darwin";
  const allowed: readonly string[] = mac ? MAC_MODIFIERS : WINDOWS_MODIFIERS;
  if (typeof value !== "string" || value.length === 0 || value.length > 40) {
    return { ok: false, message: "Press a key combination." };
  }
  const parts = value.split("+").map((part) => part.trim());
  const key = parts.pop() ?? "";
  const modifiers = new Set(parts);
  if (parts.length !== modifiers.size || [...modifiers].some((m) => !allowed.includes(m))) {
    return { ok: false, message: mac ? "Use Cmd, Control, Option, or Shift with one other key." : "Use Ctrl, Alt, or Shift with one other key." };
  }
  if (!modifiers.has("Ctrl") && !modifiers.has("Alt") && !(mac && modifiers.has("Cmd"))) {
    return { ok: false, message: mac ? "The shortcut needs Cmd, Control, or Option." : "The shortcut needs Ctrl or Alt." };
  }
  if (!KEY_PATTERN.test(key)) {
    return { ok: false, message: "That key can't be used in a shortcut." };
  }
  const accelerator = [...allowed.filter((m) => modifiers.has(m)), key].join("+");
  if ((mac ? MAC_RESERVED : WINDOWS_RESERVED).has(accelerator)) {
    return { ok: false, message: `${accelerator} is used by ${mac ? "macOS" : "Windows"} — choose another.` };
  }
  return { ok: true, accelerator };
}

export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface HotkeyManager {
  /** The shortcut currently registered, or null if none could be. */
  current(): string | null;
  /** Swaps to a new shortcut; keeps the old one if the new one is taken by another app. */
  change(value: unknown): HotkeyValidation;
}

/**
 * Owns the one registered shortcut. Registering fails (returns false) when
 * another app already holds the combination — reported, never thrown.
 */
export function createHotkeyManager(options: {
  globalShortcut: GlobalShortcutLike;
  initial: string;
  onPress: () => void;
  logger?: { warn(message: string): void };
  platform?: NodeJS.Platform;
}): HotkeyManager {
  const { globalShortcut, onPress } = options;
  const platform = options.platform ?? process.platform;
  let registered: string | null = null;

  function tryRegister(accelerator: string): boolean {
    try {
      return globalShortcut.register(accelerator, onPress);
    } catch {
      return false;
    }
  }

  const initial = validateHotkey(options.initial, platform);
  const start = initial.ok ? initial.accelerator : defaultChatHotkey(platform);
  if (tryRegister(start)) {
    registered = start;
  } else {
    options.logger?.warn(`Could not register the Zara shortcut ${start} — another app may be using it.`);
  }

  return {
    current: () => registered,
    change(value) {
      const validation = validateHotkey(value, platform);
      if (!validation.ok) return validation;
      if (validation.accelerator === registered) return validation;
      const previous = registered;
      if (previous) globalShortcut.unregister(previous);
      if (tryRegister(validation.accelerator)) {
        registered = validation.accelerator;
        return validation;
      }
      if (previous) tryRegister(previous);
      return { ok: false, message: `${validation.accelerator} is already used by another app — choose another.` };
    },
  };
}
