/**
 * Local-time helpers for ADR-006 M5. The API runs inside the desktop app on
 * the user's own PC, so the process's local time zone is the user's.
 */

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "2026-09-29" for the local calendar day of `date`. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "18:00" → minutes after midnight; null when malformed. */
export function clockMinutes(clock: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes after local midnight for `date`. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** The local day `dateKey` ("YYYY-MM-DD") at `clock` ("HH:MM"); null when either is malformed. */
export function atLocalClock(dateKey: string, clock: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const minutes = clockMinutes(clock);
  if (!match || minutes === null) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Math.floor(minutes / 60), minutes % 60);
  // Rejects impossible dates like 2026-02-31 (JS would roll them over).
  return localDateKey(date) === dateKey ? date : null;
}

/** Local midnight at the start of `date`'s day, plus `days`. */
export function startOfLocalDay(date: Date, days = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** "Tue 30 Sep" */
export function shortDayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** "3:40 PM" */
export function clockLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}
