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
