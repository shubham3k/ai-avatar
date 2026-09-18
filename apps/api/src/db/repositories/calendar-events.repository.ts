import type { CalendarEvent as PrismaCalendarEvent, PrismaClient } from "@prisma/client";
import { decodeStringArray, encodeStringArray } from "../../lib/json-array.js";

export interface CalendarEventAttendeeInput {
  email: string | null;
  displayName: string | null;
  responseStatus: string | null;
}

function decodeAttendees(raw: string | null): CalendarEventAttendeeInput[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CalendarEventAttendeeInput[]) : null;
  } catch {
    return null;
  }
}

/** Domain-facing shape — `attendeeEmails`/`attendees` are real arrays, unlike the raw DB row. */
export type CalendarEvent = Omit<PrismaCalendarEvent, "attendeeEmails" | "attendees"> & {
  attendeeEmails: string[];
  attendees: CalendarEventAttendeeInput[] | null;
};

function toDomain(row: PrismaCalendarEvent): CalendarEvent {
  return {
    ...row,
    attendeeEmails: decodeStringArray(row.attendeeEmails),
    attendees: decodeAttendees(row.attendees),
  };
}

export interface UpsertCalendarEventInput {
  userId: string;
  providerEventId: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  status: string | null;
  organizerEmail: string | null;
  organizerName: string | null;
  attendeeEmails: string[];
  attendees: CalendarEventAttendeeInput[];
  sourceUrl: string | null;
  rawUpdatedAt: Date;
}

export interface UpsertCalendarEventResult {
  event: CalendarEvent;
  created: boolean;
}

export interface SyncTally {
  created: number;
  updated: number;
}

export interface CalendarEventsRepository {
  upsertEvent(input: UpsertCalendarEventInput): Promise<UpsertCalendarEventResult>;
  upsertMany(inputs: UpsertCalendarEventInput[]): Promise<SyncTally>;
  findByProviderEventId(
    userId: string,
    calendarId: string,
    providerEventId: string,
  ): Promise<CalendarEvent | null>;
  listUpcoming(userId: string, limit: number, now?: Date): Promise<CalendarEvent[]>;
}

export function createCalendarEventsRepository(
  prisma: PrismaClient,
): CalendarEventsRepository {
  async function upsertEvent(
    input: UpsertCalendarEventInput,
  ): Promise<UpsertCalendarEventResult> {
    const existing = await prisma.calendarEvent.findUnique({
      where: {
        userId_calendarId_providerEventId: {
          userId: input.userId,
          calendarId: input.calendarId,
          providerEventId: input.providerEventId,
        },
      },
    });

    const fields = {
      title: input.title,
      description: input.description,
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      isAllDay: input.isAllDay,
      status: input.status,
      organizerEmail: input.organizerEmail,
      organizerName: input.organizerName,
      attendeeEmails: encodeStringArray(input.attendeeEmails),
      attendees: JSON.stringify(input.attendees),
      sourceUrl: input.sourceUrl,
      rawUpdatedAt: input.rawUpdatedAt,
    };

    if (existing) {
      const event = await prisma.calendarEvent.update({
        where: { id: existing.id },
        data: fields,
      });
      return { event: toDomain(event), created: false };
    }

    const event = await prisma.calendarEvent.create({
      data: {
        userId: input.userId,
        providerEventId: input.providerEventId,
        calendarId: input.calendarId,
        ...fields,
      },
    });
    return { event: toDomain(event), created: true };
  }

  async function upsertMany(inputs: UpsertCalendarEventInput[]): Promise<SyncTally> {
    let created = 0;
    let updated = 0;
    for (const input of inputs) {
      const result = await upsertEvent(input);
      if (result.created) created += 1;
      else updated += 1;
    }
    return { created, updated };
  }

  return {
    upsertEvent,
    upsertMany,

    async findByProviderEventId(userId, calendarId, providerEventId) {
      const row = await prisma.calendarEvent.findUnique({
        where: {
          userId_calendarId_providerEventId: { userId, calendarId, providerEventId },
        },
      });
      return row ? toDomain(row) : null;
    },

    async listUpcoming(userId, limit, now = new Date()) {
      const rows = await prisma.calendarEvent.findMany({
        where: { userId, startAt: { gte: now } },
        orderBy: { startAt: "asc" },
        take: limit,
      });
      return rows.map(toDomain);
    },
  };
}
