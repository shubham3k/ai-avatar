import type { PrismaClient } from "@prisma/client";

export const DEMO_USER_EMAIL = "demo@example.local";
export const DEMO_PROVIDER_MESSAGE_ID = "demo-msg-0001";
export const DEMO_CALENDAR_ID = "demo-primary";
export const DEMO_PROVIDER_EVENT_ID = "demo-event-0001";

export const DEMO_EMAIL_SUBJECT = "Final approval needed for launch assets";
export const DEMO_EMAIL_SNIPPET =
  "The design team is waiting for your feedback before the product launch.";

export const DEMO_EVENT_TITLE = "Product Launch";

export interface DemoData {
  user: { id: string };
  email: { id: string; receivedAt: Date };
  calendarEvent: { id: string; startAt: Date; endAt: Date };
}

function tomorrowAtTenUtc(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  d.setUTCHours(10, 0, 0, 0);
  return d;
}

export interface DemoUser {
  id: string;
}

/**
 * This app is single-user: every route's `resolveCallerId` falls back to
 * this one user when no `x-user-id` header is sent (which is always, in
 * the desktop app). Idempotent (`upsert`) — safe to call on every server
 * start, not just once, so a fresh install always has a user to attach
 * Google connections/synced data to without a separate manual seed step.
 */
export async function ensureDemoUser(prisma: PrismaClient): Promise<DemoUser> {
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: {
      email: DEMO_USER_EMAIL,
      displayName: "Demo User",
      timezone: "UTC",
    },
  });
  return { id: user.id };
}

export async function ensureDemoData(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<DemoData> {
  const user = await ensureDemoUser(prisma);

  const startAt = tomorrowAtTenUtc(now);
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

  const email = await prisma.email.upsert({
    where: {
      userId_providerMessageId: {
        userId: user.id,
        providerMessageId: DEMO_PROVIDER_MESSAGE_ID,
      },
    },
    update: {
      rawUpdatedAt: now,
    },
    create: {
      userId: user.id,
      providerMessageId: DEMO_PROVIDER_MESSAGE_ID,
      threadId: "demo-thread-0001",
      fromEmail: "design-team@example-partner.com",
      fromName: "Design Team",
      toEmails: JSON.stringify([DEMO_USER_EMAIL]),
      subject: DEMO_EMAIL_SUBJECT,
      snippet: DEMO_EMAIL_SNIPPET,
      bodyText:
        "The design team is waiting for your feedback before the product launch. Please review and approve the final launch assets.",
      receivedAt: now,
      isRead: false,
      sourceUrl: "https://mail.google.com/demo-msg-0001",
      rawUpdatedAt: now,
    },
  });

  const calendarEvent = await prisma.calendarEvent.upsert({
    where: {
      userId_calendarId_providerEventId: {
        userId: user.id,
        calendarId: DEMO_CALENDAR_ID,
        providerEventId: DEMO_PROVIDER_EVENT_ID,
      },
    },
    update: {
      startAt,
      endAt,
      rawUpdatedAt: now,
    },
    create: {
      userId: user.id,
      providerEventId: DEMO_PROVIDER_EVENT_ID,
      calendarId: DEMO_CALENDAR_ID,
      title: DEMO_EVENT_TITLE,
      description: "Launch day for the product.",
      startAt,
      endAt,
      organizerEmail: DEMO_USER_EMAIL,
      attendeeEmails: JSON.stringify([DEMO_USER_EMAIL]),
      sourceUrl: "https://calendar.google.com/demo-event-0001",
      rawUpdatedAt: now,
    },
  });

  return {
    user: { id: user.id },
    email: { id: email.id, receivedAt: email.receivedAt },
    calendarEvent: {
      id: calendarEvent.id,
      startAt: calendarEvent.startAt,
      endAt: calendarEvent.endAt,
    },
  };
}
