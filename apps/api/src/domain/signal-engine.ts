export const LAUNCH_APPROACHING_WINDOW_DAYS = 7;

export interface SignalCandidateInput {
  email: {
    fromEmail: string;
    subject: string;
    bodyText: string | null;
    snippet: string | null;
  };
  userIsSender: boolean;
  calendarEvent: {
    title: string;
    startAt: Date;
  };
}

export interface SignalCandidate {
  type: "user_action_required";
  sourceType: "email";
  title: string;
  summary: string;
  dueAt: Date;
  reason: string;
  importanceHints: Record<string, unknown>;
}

const ACTION_KEYWORDS = ["approval", "approve", "feedback", "waiting", "review"];
const IGNORED_SENDERS = new Set(["noreply", "no-reply", "newsletter"]);

export function evaluateApprovalScenario(
  input: SignalCandidateInput,
  now: Date = new Date(),
  windowDays: number = LAUNCH_APPROACHING_WINDOW_DAYS,
): SignalCandidate | null {
  const { email, calendarEvent } = input;

  if (input.userIsSender) return null;
  if (IGNORED_SENDERS.has(email.fromEmail.split("@")[0]?.toLowerCase() ?? "")) {
    return null;
  }

  const text = `${email.subject} ${email.bodyText ?? ""} ${email.snippet ?? ""}`.toLowerCase();
  if (!ACTION_KEYWORDS.some((keyword) => text.includes(keyword))) return null;

  const daysUntilEvent =
    (calendarEvent.startAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (daysUntilEvent < 0 || daysUntilEvent > windowDays) return null;

  return {
    type: "user_action_required",
    sourceType: "email",
    title: "Design team is waiting for your feedback",
    summary: `${email.subject}. Related event "${calendarEvent.title}" starts on ${calendarEvent.startAt.toISOString()}.`,
    dueAt: calendarEvent.startAt,
    reason:
      "The design team is waiting for feedback and the product launch is approaching.",
    importanceHints: {
      actionKeywordsMatched: ACTION_KEYWORDS.filter((k) => text.includes(k)),
      eventTitle: calendarEvent.title,
      daysUntilEvent: Math.floor(daysUntilEvent),
    },
  };
}
