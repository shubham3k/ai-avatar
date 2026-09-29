/** Sent mail older than this is never nudged (it's also outside the sent-mail sync window). */
export const FOLLOW_UP_MAX_AGE_DAYS = 14;
/** A thread still waiting isn't re-checked with Gmail more often than this. */
export const FOLLOW_UP_RECHECK_HOURS = 12;

const DAY_MS = 24 * 60 * 60_000;

export interface ThreadMessage {
  labels: string[];
  /** Epoch ms. */
  sentAt: number;
}

export type FollowUpDecision = "replied" | "wait" | "nudge" | "too_old";

/**
 * ADR-006 §6 follow-up nudges: after `followUpDays` with no reply in the
 * thread, nudge. "A reply" is any later message in the thread that the
 * user didn't send themselves (no SENT label; drafts ignored).
 */
export function decideFollowUp(input: {
  sentAt: Date;
  now: Date;
  followUpDays: number;
  threadMessages: ThreadMessage[];
}): FollowUpDecision {
  const sent = input.sentAt.getTime();
  const replied = input.threadMessages.some(
    (message) =>
      message.sentAt > sent &&
      !message.labels.includes("SENT") &&
      !message.labels.includes("DRAFT"),
  );
  if (replied) return "replied";
  const age = input.now.getTime() - sent;
  if (age > FOLLOW_UP_MAX_AGE_DAYS * DAY_MS) return "too_old";
  if (age < input.followUpDays * DAY_MS) return "wait";
  return "nudge";
}

/** "Rahul Sharma" when a name is known from their own emails, else "rahul" from the address; "Rahul and 2 others" for groups. */
export function recipientsLabel(emails: string[], knownNames: Map<string, string>): string {
  const names = emails.map((email) => {
    const known = knownNames.get(email.toLowerCase());
    if (known) return known;
    const local = email.split("@")[0] ?? email;
    return local.charAt(0).toUpperCase() + local.slice(1);
  });
  if (names.length === 0) return "them";
  if (names.length === 1) return names[0]!;
  return `${names[0]} and ${names.length - 1} other${names.length === 2 ? "" : "s"}`;
}

export function daysAgoLabel(sentAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - sentAt.getTime()) / DAY_MS);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
