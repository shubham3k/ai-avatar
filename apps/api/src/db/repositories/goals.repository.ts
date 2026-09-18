import type { Goal, PrismaClient } from "@prisma/client";

export interface CreateGoalInput {
  userId: string;
  title: string;
  description: string | null;
}

export interface UpdateGoalInput {
  title?: string;
  description?: string | null;
  active?: boolean;
}

export interface GoalsRepository {
  create(input: CreateGoalInput): Promise<Goal>;
  /** All goals for the user, most recent first — includes inactive ones. */
  listAll(userId: string): Promise<Goal[]>;
  /** Only active goals — what the AI context and prioritization use. */
  listActive(userId: string): Promise<Goal[]>;
  findById(userId: string, id: string): Promise<Goal | null>;
  update(userId: string, id: string, patch: UpdateGoalInput): Promise<Goal | null>;
}

export function createGoalsRepository(prisma: PrismaClient): GoalsRepository {
  return {
    create(input) {
      return prisma.goal.create({
        data: {
          userId: input.userId,
          title: input.title,
          description: input.description,
        },
      });
    },

    listAll(userId) {
      return prisma.goal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
    },

    listActive(userId) {
      return prisma.goal.findMany({
        where: { userId, active: true },
        orderBy: { createdAt: "desc" },
      });
    },

    findById(userId, id) {
      return prisma.goal.findFirst({ where: { id, userId } });
    },

    async update(userId, id, patch) {
      const existing = await prisma.goal.findFirst({ where: { id, userId } });
      if (!existing) return null;
      return prisma.goal.update({
        where: { id },
        data: patch,
      });
    },
  };
}
