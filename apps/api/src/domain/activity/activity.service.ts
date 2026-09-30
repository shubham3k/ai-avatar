import type { ActivityEntry, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { conflictError, notFoundError } from "../../lib/errors.js";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { deleteCreatedNote } from "../recall/notes.js";
import {
  undoCalendarCancel,
  undoCalendarCreate,
  undoCalendarUpdate,
  type CalendarUndoDependencies,
} from "../actions/calendar-undo.js";

/**
 * Activity log (ADR-006 §4): everything Zara did, with the data needed to
 * reverse it. Undo is a stored inverse per kind — never "replay the
 * model" — so it's deterministic and only touches local data.
 */
export type ActivityKind =
  | "reminder_created"
  | "reminder_deleted"
  | "memory_saved"
  | "memory_updated"
  | "memory_deleted"
  | "note_created"
  // M7: external actions the user approved (email can't be unsent — its undo is the 30 s window on the card).
  | "email_sent"
  | "calendar_created"
  | "calendar_updated"
  | "calendar_cancelled"
  | "action_cancelled";

const noUndo = z.object({}).strict();

const undoSchemas = {
  email_sent: noUndo,
  action_cancelled: noUndo,
  calendar_created: z.object({ calendarId: z.string(), providerEventId: z.string() }),
  calendar_updated: z.object({
    calendarId: z.string(),
    providerEventId: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string(),
    location: z.string().nullable(),
    notify: z.boolean(),
  }),
  calendar_cancelled: z.object({
    title: z.string(),
    start: z.string(),
    end: z.string(),
    location: z.string().nullable(),
    description: z.string().nullable(),
    attendees: z.array(z.string()),
  }),
  note_created: z.object({ path: z.string() }),
  reminder_created: z.object({ reminderId: z.string() }),
  reminder_deleted: z.object({ text: z.string(), dueAt: z.string(), remindAt: z.string().nullable() }),
  memory_saved: z.object({ factId: z.string() }),
  memory_updated: z.object({ factId: z.string(), previousContent: z.string() }),
  memory_deleted: z.object({ content: z.string(), category: z.string() }),
} satisfies Record<ActivityKind, z.ZodTypeAny>;

export type UndoData<K extends ActivityKind> = z.infer<(typeof undoSchemas)[K]>;

export interface RecordActivityInput<K extends ActivityKind = ActivityKind> {
  kind: K;
  summary: string;
  provider?: string | null;
  undo?: UndoData<K> | null;
}

export interface ActivityEntryDto {
  id: string;
  createdAt: string;
  kind: string;
  summary: string;
  provider: string | null;
  canUndo: boolean;
  undoneAt: string | null;
}

function toDto(entry: ActivityEntry): ActivityEntryDto {
  return {
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    kind: entry.kind,
    summary: entry.summary,
    provider: entry.provider,
    canUndo: entry.undo !== null && entry.undoneAt === null,
    undoneAt: entry.undoneAt?.toISOString() ?? null,
  };
}

export function createActivityService(dependencies?: { prisma?: PrismaClient; calendarUndo?: CalendarUndoDependencies }) {
  const prisma = dependencies?.prisma ?? defaultPrisma;
  const calendarUndo = dependencies?.calendarUndo ?? {};

  async function applyUndo(userId: string, kind: ActivityKind, raw: unknown): Promise<void> {
    switch (kind) {
      case "reminder_created": {
        const { reminderId } = undoSchemas.reminder_created.parse(raw);
        const deleted = await prisma.reminder.deleteMany({ where: { id: reminderId, userId } });
        if (deleted.count === 0) throw conflictError("That reminder is already gone.");
        return;
      }
      case "reminder_deleted": {
        const data = undoSchemas.reminder_deleted.parse(raw);
        await prisma.reminder.create({
          data: {
            userId,
            text: data.text,
            dueAt: new Date(data.dueAt),
            remindAt: data.remindAt ? new Date(data.remindAt) : null,
          },
        });
        return;
      }
      case "memory_saved": {
        const { factId } = undoSchemas.memory_saved.parse(raw);
        const deleted = await prisma.memoryFact.deleteMany({ where: { id: factId, userId } });
        if (deleted.count === 0) throw conflictError("That memory is already gone.");
        return;
      }
      case "memory_updated": {
        const { factId, previousContent } = undoSchemas.memory_updated.parse(raw);
        const updated = await prisma.memoryFact.updateMany({ where: { id: factId, userId }, data: { content: previousContent } });
        if (updated.count === 0) throw conflictError("That memory is already gone.");
        return;
      }
      case "memory_deleted": {
        const { content, category } = undoSchemas.memory_deleted.parse(raw);
        await prisma.memoryFact.create({ data: { userId, content, category } });
        return;
      }
      case "email_sent":
      case "action_cancelled":
        throw conflictError("That can't be undone.");
      case "calendar_created":
        await undoCalendarCreate(prisma, userId, undoSchemas.calendar_created.parse(raw), calendarUndo);
        return;
      case "calendar_updated":
        await undoCalendarUpdate(prisma, userId, undoSchemas.calendar_updated.parse(raw), calendarUndo);
        return;
      case "calendar_cancelled":
        await undoCalendarCancel(prisma, userId, undoSchemas.calendar_cancelled.parse(raw), calendarUndo);
        return;
      case "note_created": {
        const { path } = undoSchemas.note_created.parse(raw);
        if (!(await deleteCreatedNote(path))) throw conflictError("That note is already gone.");
        return;
      }
    }
  }

  return {
    async record<K extends ActivityKind>(userId: string, input: RecordActivityInput<K>): Promise<void> {
      await prisma.activityEntry.create({
        data: {
          userId,
          kind: input.kind,
          summary: input.summary,
          provider: input.provider ?? null,
          undo: input.undo ? JSON.stringify(undoSchemas[input.kind].parse(input.undo)) : null,
        },
      });
    },

    async list(userId: string, limit = 100): Promise<ActivityEntryDto[]> {
      const entries = await prisma.activityEntry.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: Math.max(1, Math.min(limit, 500)),
      });
      return entries.map(toDto);
    },

    async undo(userId: string, id: string): Promise<ActivityEntryDto> {
      const entry = await prisma.activityEntry.findFirst({ where: { id, userId } });
      if (!entry) throw notFoundError("Activity not found.");
      if (entry.undoneAt) throw conflictError("That was already undone.");
      if (!entry.undo || !(entry.kind in undoSchemas)) throw conflictError("That action can't be undone.");
      await applyUndo(userId, entry.kind as ActivityKind, JSON.parse(entry.undo));
      return toDto(await prisma.activityEntry.update({ where: { id }, data: { undoneAt: new Date() } }));
    },

    async clear(userId: string): Promise<number> {
      return (await prisma.activityEntry.deleteMany({ where: { userId } })).count;
    },
  };
}

export type ActivityService = ReturnType<typeof createActivityService>;
