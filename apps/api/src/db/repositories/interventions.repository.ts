import type {
  Intervention as PrismaIntervention,
  PrismaClient,
  Signal as PrismaSignal,
} from "@prisma/client";

// SQLite has no native enum support (Phase 4.1) — these were
// Prisma-generated enum types before; now plain string unions.
export type SignalType =
  | "user_action_required"
  | "reply_needed"
  | "approval_needed"
  | "deadline"
  | "upcoming_meeting"
  | "follow_up";
export type Priority = "low" | "medium" | "high" | "critical";

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Domain-facing shape — `importanceHints` is a parsed object, not a JSON string. */
export type Signal = Omit<PrismaSignal, "importanceHints"> & {
  importanceHints: Record<string, unknown> | null;
};

/** Domain-facing shape — `actionPayload` is a parsed object, not a JSON string. */
export type Intervention = Omit<PrismaIntervention, "actionPayload"> & {
  actionPayload: Record<string, unknown> | null;
};

function signalToDomain(row: PrismaSignal): Signal {
  return { ...row, importanceHints: parseJsonRecord(row.importanceHints) };
}

function interventionToDomain(row: PrismaIntervention): Intervention {
  return { ...row, actionPayload: parseJsonRecord(row.actionPayload) };
}

export interface SignalsRepository {
  findUniqueKey(
    userId: string,
    type: string,
    sourceType: string,
    sourceId: string,
  ): Promise<Signal | null>;
  /** All currently open (not resolved/ignored) signals for a user, oldest first. */
  listOpen(userId: string): Promise<Signal[]>;
  create(signal: {
    userId: string;
    type: SignalType;
    sourceType: string;
    sourceId: string;
    title: string;
    summary: string;
    dueAt?: Date | null;
    importanceHints?: Record<string, unknown> | null;
  }): Promise<Signal>;
}

export function createSignalsRepository(
  prisma: PrismaClient,
): SignalsRepository {
  return {
    async findUniqueKey(userId, type, sourceType, sourceId) {
      const row = await prisma.signal.findFirst({
        where: { userId, type, sourceType, sourceId },
      });
      return row ? signalToDomain(row) : null;
    },
    async listOpen(userId) {
      const rows = await prisma.signal.findMany({
        where: { userId, status: "open" },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(signalToDomain);
    },
    async create(input) {
      const row = await prisma.signal.create({
        data: {
          userId: input.userId,
          type: input.type,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          title: input.title,
          summary: input.summary,
          dueAt: input.dueAt ?? null,
          importanceHints:
            input.importanceHints === undefined || input.importanceHints === null
              ? null
              : JSON.stringify(input.importanceHints),
        },
      });
      return signalToDomain(row);
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
    priority: Priority;
    title: string;
    message: string;
    reason: string;
    actionType: string;
    actionPayload?: Record<string, unknown> | null;
    deliveredAt?: Date;
  }): Promise<Intervention>;
  resolve(id: string, now: Date): Promise<Intervention>;
  snooze(id: string, snoozedUntil: Date): Promise<Intervention>;
}

export function createInterventionsRepository(
  prisma: PrismaClient,
): InterventionsRepository {
  return {
    async findBySignalId(signalId) {
      const row = await prisma.intervention.findUnique({ where: { signalId } });
      return row ? interventionToDomain(row) : null;
    },
    async listInbox(userId, now) {
      // Priority is a plain string column now (Phase 4.1, no DB enum), so
      // "desc" would sort alphabetically — wrong order. Sort in application
      // code by rank instead, createdAt as the tiebreaker, same as before.
      const rows = await prisma.intervention.findMany({
        where: {
          userId,
          OR: [
            { status: "pending" },
            { status: "snoozed", snoozedUntil: { lte: now } },
          ],
        },
        orderBy: { createdAt: "asc" },
      });
      return rows
        .map(interventionToDomain)
        .sort((a, b) => PRIORITY_RANK[b.priority as Priority] - PRIORITY_RANK[a.priority as Priority]);
    },
    async findById(id) {
      const row = await prisma.intervention.findUnique({ where: { id } });
      return row ? interventionToDomain(row) : null;
    },
    async create(input) {
      const row = await prisma.intervention.create({
        data: {
          userId: input.userId,
          signalId: input.signalId,
          priority: input.priority,
          title: input.title,
          message: input.message,
          reason: input.reason,
          actionType: input.actionType,
          actionPayload:
            input.actionPayload === undefined || input.actionPayload === null
              ? null
              : JSON.stringify(input.actionPayload),
          lastDeliveredAt: input.deliveredAt ?? new Date(),
        },
      });
      return interventionToDomain(row);
    },
    async resolve(id, now) {
      const row = await prisma.intervention.update({
        where: { id },
        data: { status: "resolved", resolvedAt: now, snoozedUntil: null },
      });
      return interventionToDomain(row);
    },
    async snooze(id, snoozedUntil) {
      const row = await prisma.intervention.update({
        where: { id },
        data: { status: "snoozed", snoozedUntil },
      });
      return interventionToDomain(row);
    },
  };
}
