import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { decodeStringArray } from "../../lib/json-array.js";

export interface MeetingBrief {
  /** Who's coming (not the user), e.g. ["Rahul Sharma", "Priya", "and 3 more"]. */
  attendees: string[];
  /** The latest emails with them, newest first. */
  recentEmails: { from: string; subject: string; when: string }[];
  /** Still-open alerts and reminders that mention them. */
  openItems: string[];
}

export interface MeetingForBrief {
  attendees: { email: string | null; displayName: string | null; responseStatus: string | null }[] | null;
  organizerEmail: string | null;
  organizerName: string | null;
}

const MAX_NAMES = 4;
const RECENT_DAYS = 14;
const DAY_MS = 24 * 60 * 60_000;

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function whenLabel(date: Date, now: Date): string {
  const days = Math.floor((now.getTime() - date.getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The people in a meeting other than the user: [{ email, name }], organizer included, declined excluded. */
export function meetingPeople(event: MeetingForBrief, selfEmail: string | null): { email: string; name: string }[] {
  const self = selfEmail?.toLowerCase() ?? null;
  const people = new Map<string, string>();
  const add = (email: string | null, name: string | null) => {
    const key = email?.trim().toLowerCase();
    if (!key || key === self || people.has(key)) return;
    people.set(key, name?.trim() || nameFromEmail(key));
  };
  add(event.organizerEmail, event.organizerName);
  for (const attendee of event.attendees ?? []) {
    if (attendee.responseStatus === "declined") continue;
    add(attendee.email, attendee.displayName);
  }
  return [...people].map(([email, name]) => ({ email, name }));
}

export function attendeeLabels(people: { name: string }[]): string[] {
  const names = people.slice(0, MAX_NAMES).map((person) => person.name);
  if (people.length > MAX_NAMES) names.push(`and ${people.length - MAX_NAMES} more`);
  return names;
}

/**
 * ADR-006 §6: the summary on the 10-minute meeting card — attendees,
 * recent emails with them, open items. Built from local data only (no AI
 * call). Null for meetings with nobody else in them.
 */
export async function loadMeetingBrief(
  userId: string,
  event: MeetingForBrief,
  now: Date,
  dependencies?: { prisma?: PrismaClient },
): Promise<MeetingBrief | null> {
  const prisma = dependencies?.prisma ?? defaultPrisma;
  const integration = await prisma.integration.findFirst({
    where: { userId, provider: "google" },
    select: { providerAccountEmail: true },
  });
  const people = meetingPeople(event, integration?.providerAccountEmail ?? null);
  if (people.length === 0) return null;

  const emails = people.map((person) => person.email);
  const recent = await prisma.email.findMany({
    where: {
      userId,
      receivedAt: { gte: new Date(now.getTime() - RECENT_DAYS * DAY_MS) },
      OR: [{ fromEmail: { in: emails } }, ...emails.map((email) => ({ toEmails: { contains: email } }))],
    },
    orderBy: { receivedAt: "desc" },
    take: 3,
    select: { fromEmail: true, fromName: true, subject: true, receivedAt: true, labels: true },
  });

  const firstNames = people
    .map((person) => person.name.split(/\s+/)[0] ?? "")
    .filter((name) => name.length >= 3)
    .map((name) => name.toLowerCase());
  const mentions = (text: string) => {
    const lower = text.toLowerCase();
    return firstNames.some((name) => lower.includes(name)) || emails.some((email) => lower.includes(email));
  };

  const [pending, reminders] = await Promise.all([
    prisma.intervention.findMany({
      where: { userId, status: { in: ["pending", "snoozed"] }, signal: { sourceType: { not: "calendar_event" } } },
      select: { title: true, message: true },
      take: 50,
    }),
    prisma.reminder.findMany({
      where: { userId, dueAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) } },
      select: { text: true },
      take: 50,
    }),
  ]);
  const openItems = [
    ...pending.filter((item) => mentions(`${item.title} ${item.message}`)).map((item) => item.title),
    ...reminders.filter((reminder) => mentions(reminder.text)).map((reminder) => reminder.text),
  ].slice(0, 3);

  return {
    attendees: attendeeLabels(people),
    recentEmails: recent.map((email) => ({
      from: decodeStringArray(email.labels).includes("SENT") ? "You" : (email.fromName ?? nameFromEmail(email.fromEmail)),
      subject: email.subject,
      when: whenLabel(email.receivedAt, now),
    })),
    openItems,
  };
}
