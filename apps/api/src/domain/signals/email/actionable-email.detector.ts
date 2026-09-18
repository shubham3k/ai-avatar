import {
  ACTIONABLE_EMAIL_WINDOW_DAYS,
  isExcludedByLabels,
  isExcludedSender,
  matchHighConfidenceRules,
  matchMediumConfidenceRules,
} from "./actionable-email.rules.js";
import type {
  ActionableEmailInput,
  ActionableEmailResult,
} from "./actionable-email.types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function notActionable(reason: string): ActionableEmailResult {
  return { actionable: false, confidence: null, reason, matchedRules: [] };
}

function senderLabel(fromName: string | null, fromEmail: string): string {
  const trimmedName = fromName?.trim();
  if (trimmedName) return trimmedName;
  const localPart = fromEmail.split("@")[0]?.trim();
  return localPart && localPart.length > 0 ? localPart : "Someone";
}

function buildReason(
  fromName: string | null,
  fromEmail: string,
  subject: string,
): string {
  const who = senderLabel(fromName, fromEmail);
  return subject.length > 0
    ? `${who} appears to need a response about "${subject}".`
    : `${who} appears to need a response.`;
}

/**
 * Deterministic, rule-based check for whether a stored email looks like it
 * needs the user's attention. Pure function: same input always produces the
 * same output, and it never throws — missing/malformed fields just fail the
 * relevant gate rather than crashing.
 */
export function detectActionableEmail(
  input: ActionableEmailInput,
  now: Date = new Date(),
  windowDays: number = ACTIONABLE_EMAIL_WINDOW_DAYS,
): ActionableEmailResult {
  const fromEmail = (input.fromEmail ?? "").trim();
  const subject = (input.subject ?? "").trim();
  const snippet = (input.snippet ?? "").trim();
  const labels = Array.isArray(input.labels) ? input.labels : [];

  if (!fromEmail) {
    return notActionable("Email has no identifiable sender.");
  }

  if (input.isRead) {
    return notActionable("Email has already been read.");
  }

  if (isExcludedSender(fromEmail)) {
    return notActionable("Sender looks automated/bulk (e.g. no-reply, newsletter).");
  }

  if (isExcludedByLabels(labels)) {
    return notActionable("Gmail categorized this as promotional/social/automated mail.");
  }

  const receivedAt = input.receivedAt;
  if (!receivedAt || Number.isNaN(receivedAt.getTime())) {
    return notActionable("Email has no valid received date.");
  }
  const ageDays = (now.getTime() - receivedAt.getTime()) / DAY_MS;
  if (ageDays > windowDays) {
    return notActionable(`Email is older than the ${windowDays}-day attention window.`);
  }
  if (ageDays < -1) {
    // Clock skew / bad data — a message "from the future" isn't trustworthy.
    return notActionable("Email has an implausible received date.");
  }

  const text = `${subject} ${snippet}`.toLowerCase().replace(/\s+/g, " ").trim();

  const highMatches = matchHighConfidenceRules(text);
  if (highMatches.length > 0) {
    return {
      actionable: true,
      confidence: "high",
      reason: buildReason(input.fromName, fromEmail, subject),
      matchedRules: highMatches,
    };
  }

  const mediumMatches = matchMediumConfidenceRules(text);
  if (mediumMatches.length > 0) {
    return {
      actionable: true,
      confidence: "medium",
      reason: buildReason(input.fromName, fromEmail, subject),
      matchedRules: mediumMatches,
    };
  }

  return notActionable("No actionable request language detected.");
}
