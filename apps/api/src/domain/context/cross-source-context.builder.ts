import { extractMeaningfulTokens, tokenOverlap } from "./cross-source-context.rules.js";
import type {
  ContextCalendarEventInput,
  ContextEmailInput,
  CrossSourceContext,
  CrossSourceRelationship,
} from "./cross-source-context.types.js";

const HOUR_MS = 60 * 60 * 1000;

function correlate(
  email: ContextEmailInput,
  event: ContextCalendarEventInput,
): CrossSourceRelationship | null {
  const fromEmail = (email.fromEmail ?? "").trim().toLowerCase();
  const attendeeMatch =
    fromEmail.length > 0 &&
    event.attendeeEmails.some((attendee) => attendee.trim().toLowerCase() === fromEmail);

  const emailTokens = extractMeaningfulTokens(
    `${email.subject ?? ""} ${email.snippet ?? ""}`,
  );
  const eventTokens = extractMeaningfulTokens(event.summary ?? "");
  const overlap = tokenOverlap(emailTokens, eventTokens);

  if (attendeeMatch) {
    return {
      type: "attendee_match",
      strength: "strong",
      reason: `Email sender ${email.fromEmail} is an attendee of the upcoming calendar event.`,
      ...(overlap.length > 0 ? { matchedTerms: overlap } : {}),
    };
  }

  if (overlap.length > 0) {
    return {
      type: "topic_overlap",
      strength: "possible",
      reason: `Email and calendar event share meaningful terms: ${overlap.join(", ")}.`,
      matchedTerms: overlap,
    };
  }

  return null;
}

/**
 * Deterministic, pure cross-source correlation: given already-loaded Emails
 * and CalendarEvents, finds obvious relationships between them. Does not
 * touch Prisma or any external API. Temporal proximity alone never creates
 * a relationship — it's attached as context only once a relationship is
 * already established on other evidence.
 */
export function buildCrossSourceContext(
  emails: ContextEmailInput[],
  calendarEvents: ContextCalendarEventInput[],
): CrossSourceContext[] {
  const contexts: CrossSourceContext[] = [];

  for (const email of emails) {
    for (const event of calendarEvents) {
      const relationship = correlate(email, event);
      if (!relationship) continue;

      contexts.push({
        emailId: email.id,
        calendarEventId: event.id,
        relationship,
        temporalContext: {
          emailReceivedAt: email.receivedAt.toISOString(),
          eventStartAt: event.startAt.toISOString(),
          hoursBetween: Math.round(
            (event.startAt.getTime() - email.receivedAt.getTime()) / HOUR_MS,
          ),
        },
      });
    }
  }

  return contexts;
}
