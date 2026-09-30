import type { PrismaClient } from "@prisma/client";
import { createCalendarEventsRepository } from "../../db/repositories/calendar-events.repository.js";
import { createCalendarWriteService, type CalendarWriteService } from "../../providers/google/calendar/calendar-write.service.js";
import { toCalendarEventInput } from "../calendar-sync.service.js";
import { createGoogleConnectionService, type GoogleConnectionService } from "../google-connection.service.js";

export interface CalendarUndoDependencies {
  connection?: GoogleConnectionService;
  calendar?: CalendarWriteService;
}

/**
 * Undo (from Settings → Activity) for calendar changes Zara made after the
 * user approved them. The user clicking Undo is the approval.
 */
export async function undoCalendarCreate(
  prisma: PrismaClient,
  userId: string,
  data: { calendarId: string; providerEventId: string },
  deps: CalendarUndoDependencies = {},
): Promise<void> {
  const connection = deps.connection ?? createGoogleConnectionService();
  const calendar = deps.calendar ?? createCalendarWriteService();
  const token = await connection.getDecryptedRefreshToken(userId);
  const row = await prisma.calendarEvent.findFirst({ where: { userId, providerEventId: data.providerEventId } });
  let attendees: string[] = [];
  try {
    attendees = row ? (JSON.parse(row.attendeeEmails) as string[]) : [];
  } catch {
    attendees = [];
  }
  await calendar.cancel(token, data.calendarId, data.providerEventId, attendees.length > 0);
  await prisma.calendarEvent.deleteMany({ where: { userId, providerEventId: data.providerEventId } });
}

export async function undoCalendarUpdate(
  prisma: PrismaClient,
  userId: string,
  data: { calendarId: string; providerEventId: string; title: string; start: string; end: string; location: string | null; notify: boolean },
  deps: CalendarUndoDependencies = {},
): Promise<void> {
  const connection = deps.connection ?? createGoogleConnectionService();
  const calendar = deps.calendar ?? createCalendarWriteService();
  const token = await connection.getDecryptedRefreshToken(userId);
  const restored = await calendar.update(
    token,
    data.calendarId,
    data.providerEventId,
    { title: data.title, start: new Date(data.start), end: new Date(data.end), location: data.location },
    data.notify,
  );
  const input = toCalendarEventInput(userId, restored, new Date());
  if (input) await createCalendarEventsRepository(prisma).upsertEvent(input);
}

export async function undoCalendarCancel(
  prisma: PrismaClient,
  userId: string,
  data: { title: string; start: string; end: string; location: string | null; description: string | null; attendees: string[] },
  deps: CalendarUndoDependencies = {},
): Promise<void> {
  const connection = deps.connection ?? createGoogleConnectionService();
  const calendar = deps.calendar ?? createCalendarWriteService();
  const token = await connection.getDecryptedRefreshToken(userId);
  // A cancelled event can't be un-deleted — it's recreated (attendees are re-invited).
  const created = await calendar.create(token, {
    title: data.title,
    start: new Date(data.start),
    end: new Date(data.end),
    attendees: data.attendees,
    location: data.location,
    description: data.description,
  });
  const input = toCalendarEventInput(userId, created, new Date());
  if (input) await createCalendarEventsRepository(prisma).upsertEvent(input);
}
