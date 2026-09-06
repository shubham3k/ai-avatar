import { Prisma } from "@prisma/client";
import type {
  Intervention,
  PrismaClient,
  Signal,
} from "@prisma/client";

export interface SignalsRepository {
  findUniqueKey(
    userId: string,
    type: string,
    sourceType: string,
    sourceId: string,
  ): Promise<Signal | null>;
  create(signal: {
    userId: string;
    type: Signal["type"];
    sourceType: string;
    sourceId: string;
    title: string;
    summary: string;
    dueAt?: Date | null;
    importanceHints?: Prisma.InputJsonValue | null;
  }): Promise<Signal>;
}

export function createSignalsRepository(
  prisma: PrismaClient,
): SignalsRepository {
  return {
    findUniqueKey(userId, type, sourceType, sourceId) {
      return prisma.signal.findFirst({
        where: { userId, type: type as Signal["type"], sourceType, sourceId },
      });
    },
    create(input) {
      return prisma.signal.create({
        data: {
          userId: input.userId,
          type: input.type,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          title: input.title,
          summary: input.summary,
          dueAt: input.dueAt ?? null,
          importanceHints:
            input.importanceHints === undefined
              ? Prisma.DbNull
              : input.importanceHints === null
                ? Prisma.JsonNull
                : input.importanceHints,
        },
      });
    },
  };
}

export interface InterventionsRepository {
  findBySignalId(signalId: string): Promise<Intervention | null>;
  listInbox(userId: string, now: Date): Promise<Intervention[]>;
  findById(id: string): Promise<Intervention | null>;
  create(intervention: {
    userId: string;
    signalId: string;
    priority: "low" | "medium" | "high" | "critical";
    title: string;
    message: string;
    reason: string;
    actionType: string;
    actionPayload?: Prisma.InputJsonValue | null;
    deliveredAt?: Date;
  }): Promise<Intervention>;
  resolve(id: string, now: Date): Promise<Intervention>;
  snooze(id: string, snoozedUntil: Date): Promise<Intervention>;
}

export function createInterventionsRepository(
  prisma: PrismaClient,
): InterventionsRepository {
  return {
    findBySignalId(signalId) {
      return prisma.intervention.findUnique({ where: { signalId } });
    },
    listInbox(userId, now) {
      return prisma.intervention.findMany({
        where: {
          userId,
          OR: [
            { status: "pending" },
            { status: "snoozed", snoozedUntil: { lte: now } },
          ],
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });
    },
    findById(id) {
      return prisma.intervention.findUnique({ where: { id } });
    },
    create(input) {
      return prisma.intervention.create({
        data: {
          userId: input.userId,
          signalId: input.signalId,
          priority: input.priority,
          title: input.title,
          message: input.message,
          reason: input.reason,
          actionType: input.actionType,
          actionPayload:
            input.actionPayload === undefined
              ? Prisma.DbNull
              : input.actionPayload === null
                ? Prisma.JsonNull
                : input.actionPayload,
          lastDeliveredAt: input.deliveredAt ?? new Date(),
        },
      });
    },
    resolve(id, now) {
      return prisma.intervention.update({
        where: { id },
        data: { status: "resolved", resolvedAt: now, snoozedUntil: null },
      });
    },
    snooze(id, snoozedUntil) {
      return prisma.intervention.update({
        where: { id },
        data: { status: "snoozed", snoozedUntil },
      });
    },
  };
}
