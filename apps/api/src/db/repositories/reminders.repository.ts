import type { PrismaClient, Reminder } from "@prisma/client";

export interface CreateReminderInput {
  userId: string;
  text: string;
  dueAt: Date;
  /** Null (the default) means "fires exactly at dueAt" — the exact-time-picker path. Set to fire earlier than dueAt (e.g. parsed from free text). */
  remindAt?: Date | null;
}

export interface RemindersRepository {
  create(input: CreateReminderInput): Promise<Reminder>;
  /** All reminders for the user, soonest due first. */
  listAll(userId: string): Promise<Reminder[]>;
  /** Reminders whose remindAt (or dueAt, if remindAt was never set) is at or before `now` — what reminder-detection.service.ts turns into interventions. */
  listDue(userId: string, now: Date, limit: number): Promise<Reminder[]>;
  findById(userId: string, id: string): Promise<Reminder | null>;
  delete(userId: string, id: string): Promise<boolean>;
}

export function createRemindersRepository(prisma: PrismaClient): RemindersRepository {
  return {
    create(input) {
      return prisma.reminder.create({
        data: {
          userId: input.userId,
          text: input.text,
          dueAt: input.dueAt,
          remindAt: input.remindAt ?? null,
        },
      });
    },

    listAll(userId) {
      return prisma.reminder.findMany({
        where: { userId },
        orderBy: { dueAt: "asc" },
      });
    },

    listDue(userId, now, limit) {
      return prisma.reminder.findMany({
        where: {
          userId,
          OR: [{ remindAt: { lte: now } }, { remindAt: null, dueAt: { lte: now } }],
        },
        orderBy: { dueAt: "asc" },
        take: limit,
      });
    },

    findById(userId, id) {
      return prisma.reminder.findFirst({ where: { id, userId } });
    },

    async delete(userId, id) {
      const existing = await prisma.reminder.findFirst({ where: { id, userId } });
      if (!existing) return false;
      await prisma.reminder.delete({ where: { id } });
      return true;
    },
  };
}
