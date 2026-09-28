/** e.g. "3:45 PM" — used for the tray menu's "Paused until ..." label. */
export function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
