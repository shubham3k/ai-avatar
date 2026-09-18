import { buildCrossSourceContext } from "./context/cross-source-context.builder.js";
import {
  CALENDAR_WINDOW_DAYS,
  CONTEXT_FETCH_LIMIT,
  EMAIL_WINDOW_DAYS,
} from "./context/cross-source-context.rules.js";
import type {
  ContextCalendarEventInput,
  ContextEmailInput,
  CrossSourceContext,
} from "./context/cross-source-context.types.js";
import {
  createCalendarEventsRepository,
  type CalendarEventsRepository,
} from "../db/repositories/calendar-events.repository.js";
import {
  createEmailsRepository,
  type EmailsRepository,
} from "../db/repositories/emails.repository.js";
import { prisma } from "../lib/prisma.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function createCrossSourceContextService(dependencies?: {
  emails?: EmailsRepository;
  events?: CalendarEventsRepository;
}) {
  const emails = dependencies?.emails ?? createEmailsRepository(prisma);
  const events = dependencies?.events ?? createCalendarEventsRepository(prisma);

  return {
    async getContext(
      userId: string,
      now: Date = new Date(),
    ): Promise<CrossSourceContext[]> {
      const [recentEmails, upcomingEvents] = await Promise.all([
        emails.listRecent(userId, CONTEXT_FETCH_LIMIT),
        events.listUpcoming(userId, CONTEXT_FETCH_LIMIT, now),
      ]);

      const emailCutoff = new Date(now.getTime() - EMAIL_WINDOW_DAYS * DAY_MS);
      const calendarCutoff = new Date(now.getTime() + CALENDAR_WINDOW_DAYS * DAY_MS);

      const boundedEmails: ContextEmailInput[] = recentEmails
        .filter((email) => email.receivedAt >= emailCutoff)
        .map((email) => ({
          id: email.id,
          fromEmail: email.fromEmail,
          subject: email.subject,
          snippet: email.snippet,
          receivedAt: email.receivedAt,
        }));

      const boundedEvents: ContextCalendarEventInput[] = upcomingEvents
        .filter((event) => event.startAt <= calendarCutoff)
        .map((event) => ({
          id: event.id,
          summary: event.title,
          startAt: event.startAt,
          attendeeEmails: event.attendeeEmails,
        }));

      return buildCrossSourceContext(boundedEmails, boundedEvents);
    },
  };
}

export type CrossSourceContextService = ReturnType<
  typeof createCrossSourceContextService
>;
