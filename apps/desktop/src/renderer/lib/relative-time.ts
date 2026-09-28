/** "just now" / "3m ago" / "2h ago" — used for the "last checked" indicator. */
export function formatRelativeTime(fromMs: number, nowMs: number = Date.now()): string {
  const diffSec = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  return `${diffHour}h ago`;
}
