import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { decodeStringArray } from "../../lib/json-array.js";
import { clockLabel, shortDayLabel } from "../proactive/local-time.js";

const DAY_MS = 24 * 60 * 60_000;
const LOOKBACK_DAYS = 90;

export interface PersonProfile {
  name: string;
  email: string;
  emailsFromThem: number;
  emailsToThem: number;
  lastEmail: { subject: string; when: string; direction: "from them" | "to them" } | null;
  recentSubjects: string[];
  upcomingMeetings: string[];
  pastMeetings: number;
  /** Memory facts that mention them. */
  notes: string[];
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * ADR-006 §7 "people memory" (experimental, can be switched off in
 * Settings → Recall): a profile of someone the user deals with, built on
 * the fly from local email, calendar, and memory — nothing is stored and
 * no AI is involved.
 */
export function createPeopleService(dependencies?: { prisma?: PrismaClient }) {
  const prisma = dependencies?.prisma ?? defaultPrisma;

  /** Best match for a name or address among people in the user's email/calendar. */
  async function resolve(userId: string, query: string): Promise<{ name: string; email: string } | null> {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return null;
    const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS);
    const senders = await prisma.email.groupBy({
      by: ["fromEmail", "fromName"],
      where: { userId, receivedAt: { gte: since } },
      _count: true,
    });
    const candidates = new Map<string, { name: string; count: number }>();
    for (const row of senders) {
      const email = row.fromEmail.toLowerCase();
      if (!email) continue;
      const existing = candidates.get(email);
      candidates.set(email, { name: existing?.name ?? row.fromName ?? nameFromEmail(email), count: (existing?.count ?? 0) + row._count });
    }
    const events = await prisma.calendarEvent.findMany({ where: { userId, startAt: { gte: since } }, select: { attendees: true } });
    for (const event of events) {
      let attendees: { email: string | null; displayName: string | null }[] = [];
      try {
        attendees = event.attendees ? JSON.parse(event.attendees) : [];
      } catch {
        attendees = [];
      }
      for (const attendee of attendees) {
        const email = attendee.email?.toLowerCase();
        if (!email) continue;
        const existing = candidates.get(email);
        candidates.set(email, { name: existing?.name ?? attendee.displayName ?? nameFromEmail(email), count: (existing?.count ?? 0) + 1 });
      }
    }
    const matches = [...candidates]
      .filter(([email, info]) => email.includes(needle) || info.name.toLowerCase().includes(needle))
      .sort((a, b) => b[1].count - a[1].count);
    const [best] = matches;
    return best ? { email: best[0], name: best[1].name } : null;
  }

  return {
    async profile(userId: string, query: string, now: Date = new Date()): Promise<PersonProfile | null> {
      const person = await resolve(userId, query);
      if (!person) return null;
      const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
      const mail = await prisma.email.findMany({
        where: {
          userId,
          receivedAt: { gte: since },
          OR: [{ fromEmail: person.email }, { toEmails: { contains: person.email } }],
        },
        orderBy: { receivedAt: "desc" },
        select: { subject: true, receivedAt: true, fromEmail: true, labels: true },
        take: 200,
      });
      const fromThem = mail.filter((row) => row.fromEmail.toLowerCase() === person.email);
      const toThem = mail.filter((row) => decodeStringArray(row.labels).includes("SENT"));
      const events = await prisma.calendarEvent.findMany({
        where: { userId, attendeeEmails: { contains: person.email }, startAt: { gte: since } },
        orderBy: { startAt: "asc" },
        select: { title: true, startAt: true, status: true },
      });
      const firstName = person.name.split(/\s+/)[0]?.toLowerCase() ?? "";
      const facts = await prisma.memoryFact.findMany({ where: { userId }, select: { content: true } });
      const latest = mail[0];
      return {
        name: person.name,
        email: person.email,
        emailsFromThem: fromThem.length,
        emailsToThem: toThem.length,
        lastEmail: latest
          ? {
              subject: latest.subject,
              when: shortDayLabel(latest.receivedAt),
              direction: decodeStringArray(latest.labels).includes("SENT") ? "to them" : "from them",
            }
          : null,
        recentSubjects: [...new Set(mail.map((row) => row.subject))].slice(0, 5),
        upcomingMeetings: events
          .filter((event) => event.startAt >= now && event.status !== "cancelled")
          .slice(0, 3)
          .map((event) => `${event.title} — ${shortDayLabel(event.startAt)}, ${clockLabel(event.startAt)}`),
        pastMeetings: events.filter((event) => event.startAt < now).length,
        notes: facts
          .map((fact) => fact.content)
          .filter((content) => (firstName.length >= 3 && content.toLowerCase().includes(firstName)) || content.toLowerCase().includes(person.email))
          .slice(0, 5),
      };
    },
  };
}

export type PeopleService = ReturnType<typeof createPeopleService>;
