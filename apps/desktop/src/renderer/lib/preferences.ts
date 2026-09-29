/**
 * Renderer-only preferences (ADR-006), kept in localStorage — they only
 * affect this window's behaviour, so they don't need the main process.
 */
const CHAT_AUTO_HIDE_KEY = "zara.chatAutoHideSeconds";
export const DEFAULT_CHAT_AUTO_HIDE_SECONDS = 30;
export const MAX_CHAT_AUTO_HIDE_SECONDS = 600;

/** Seconds of inactivity before the chat panel hides; 0 = never. */
export function getChatAutoHideSeconds(): number {
  try {
    const raw = window.localStorage.getItem(CHAT_AUTO_HIDE_KEY);
    if (raw === null) return DEFAULT_CHAT_AUTO_HIDE_SECONDS;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= MAX_CHAT_AUTO_HIDE_SECONDS
      ? Math.round(value)
      : DEFAULT_CHAT_AUTO_HIDE_SECONDS;
  } catch {
    return DEFAULT_CHAT_AUTO_HIDE_SECONDS;
  }
}

export function setChatAutoHideSeconds(seconds: number): void {
  const clamped = Math.max(0, Math.min(MAX_CHAT_AUTO_HIDE_SECONDS, Math.round(seconds)));
  try {
    window.localStorage.setItem(CHAT_AUTO_HIDE_KEY, String(clamped));
  } catch {
    // Storage unavailable — the default keeps applying.
  }
}

/**
 * ADR-006 M4: how Zara speaks and listens.
 * - engine: OpenAI TTS (default), a local Windows voice (free), or off.
 * - inputMode: click-to-talk (default) or hands-free (voice-activity detection).
 */
export type VoiceEngine = "openai" | "windows" | "off";
export type VoiceInputMode = "click" | "handsfree";
/** How Hindi words are written when Zara transcribes you: Roman letters (Hinglish, as you type) or Devanagari. */
export type HindiScript = "latin" | "devanagari";

export interface VoicePreferences {
  engine: VoiceEngine;
  openaiVoice: string;
  /** A Windows voice's name, or null for the system default. */
  windowsVoice: string | null;
  inputMode: VoiceInputMode;
  hindiScript: HindiScript;
}

const VOICE_KEY = "zara.voice";

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  engine: "openai",
  openaiVoice: "marin",
  windowsVoice: null,
  inputMode: "click",
  hindiScript: "latin",
};

function isEngine(value: unknown): value is VoiceEngine {
  return value === "openai" || value === "windows" || value === "off";
}

export function getVoicePreferences(): VoicePreferences {
  try {
    const raw = window.localStorage.getItem(VOICE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<Record<keyof VoicePreferences, unknown>>;
    return {
      engine: isEngine(parsed.engine) ? parsed.engine : DEFAULT_VOICE_PREFERENCES.engine,
      openaiVoice:
        typeof parsed.openaiVoice === "string" && /^[a-z]{2,20}$/.test(parsed.openaiVoice)
          ? parsed.openaiVoice
          : DEFAULT_VOICE_PREFERENCES.openaiVoice,
      windowsVoice: typeof parsed.windowsVoice === "string" && parsed.windowsVoice ? parsed.windowsVoice : null,
      inputMode: parsed.inputMode === "handsfree" ? "handsfree" : "click",
      hindiScript: parsed.hindiScript === "devanagari" ? "devanagari" : "latin",
    };
  } catch {
    return { ...DEFAULT_VOICE_PREFERENCES };
  }
}

export function setVoicePreferences(patch: Partial<VoicePreferences>): VoicePreferences {
  const next = { ...getVoicePreferences(), ...patch };
  try {
    window.localStorage.setItem(VOICE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — defaults keep applying.
  }
  return next;
}
