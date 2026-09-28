export const GENERIC_REMINDER_ERROR = "Could not create that reminder. Please try again.";

export type ReminderResult = { ok: true; reminder: unknown } | { ok: false; message: string };

/**
 * The free-text/voice reminder IPC calls resolve with
 * `{ ok: true, reminder }` or `{ ok: false, message }` (register-ipc.ts's
 * toReminderCreateResult) — the failure message is the API's own
 * user-facing text ("Your Groq API key was rejected…", "When should I
 * remind you?…"), shown as-is.
 */
export function readReminderResult(raw: unknown): ReminderResult {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; reminder?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, reminder: result.reminder };
    if (typeof result.message === "string" && result.message.length > 0) {
      return { ok: false, message: result.message };
    }
  }
  return { ok: false, message: GENERIC_REMINDER_ERROR };
}

/**
 * Turns a created ReminderDto into a human confirmation line. remindAt is
 * when the popup will actually appear — ahead of dueAt for a heads-up
 * ("meeting at 5pm" → "I'll remind you at 4:50 PM…"), equal to it for a
 * direct ping ("Reminder set for Sep 28, 4:00 PM…").
 */
export function describeCreatedReminder(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "Reminder added.";
  const { text, dueAt, remindAt } = raw as {
    text?: unknown;
    dueAt?: unknown;
    remindAt?: unknown;
  };
  if (typeof text !== "string" || typeof dueAt !== "string") return "Reminder added.";
  const timeFormat: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const dueLabel = new Date(dueAt).toLocaleString([], { ...timeFormat, month: "short", day: "numeric" });
  if (typeof remindAt === "string" && remindAt && new Date(remindAt).getTime() !== new Date(dueAt).getTime()) {
    const remindLabel = new Date(remindAt).toLocaleTimeString([], timeFormat);
    return `I'll remind you at ${remindLabel}: "${text}" (${dueLabel}).`;
  }
  return `Reminder set for ${dueLabel}: "${text}".`;
}

/** Distinguishes "blocked" from "no microphone" — getUserMedia's DOMException names. */
export function microphoneErrorMessage(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? (err as { name: unknown }).name : null;
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Plug one in and try again.";
  }
  if (name === "NotReadableError") {
    return "The microphone is busy in another app. Close it and try again.";
  }
  return "Could not access the microphone — check this app's permission in Windows Settings → Privacy → Microphone.";
}
