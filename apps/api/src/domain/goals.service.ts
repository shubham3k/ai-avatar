import type { Goal } from "@prisma/client";
import { createGoalsRepository, type GoalsRepository } from "../db/repositories/goals.repository.js";
import { notFoundError, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export const GOAL_TITLE_MAX_LENGTH = 200;
export const GOAL_DESCRIPTION_MAX_LENGTH = 2000;

export interface CreateGoalRequest {
  title: string;
  description?: string | null | undefined;
}

export interface UpdateGoalRequest {
  title?: string | undefined;
  description?: string | null | undefined;
  active?: boolean | undefined;
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw validationError("Goal title is required.");
  }
  if (trimmed.length > GOAL_TITLE_MAX_LENGTH) {
    throw validationError(`Goal title must be ${GOAL_TITLE_MAX_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

function normalizeDescription(description: string | null | undefined): string | null {
  if (description === undefined || description === null) return null;
  const trimmed = description.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > GOAL_DESCRIPTION_MAX_LENGTH) {
    throw validationError(
      `Goal description must be ${GOAL_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    );
  }
  return trimmed;
}

/**
 * Deliberately minimal: create/list/update(title, description, active).
 * No hierarchy, no progress tracking, no task/project management — see
 * docs/GOALS.md. This is the only place Goal validation rules live; the
 * repository and route stay thin.
 */
export function createGoalsService(dependencies?: { goals?: GoalsRepository }) {
  const goals = dependencies?.goals ?? createGoalsRepository(prisma);

  return {
    async createGoal(userId: string, request: CreateGoalRequest): Promise<Goal> {
      const title = normalizeTitle(request.title);
      const description = normalizeDescription(request.description);
      return goals.create({ userId, title, description });
    },

    async listGoals(userId: string, includeInactive: boolean): Promise<Goal[]> {
      return includeInactive ? goals.listAll(userId) : goals.listActive(userId);
    },

    async updateGoal(userId: string, id: string, request: UpdateGoalRequest): Promise<Goal> {
      const patch: { title?: string; description?: string | null; active?: boolean } = {};
      if (request.title !== undefined) patch.title = normalizeTitle(request.title);
      if (request.description !== undefined) {
        patch.description = normalizeDescription(request.description);
      }
      if (request.active !== undefined) patch.active = request.active;

      const updated = await goals.update(userId, id, patch);
      if (!updated) {
        throw notFoundError("Goal not found.");
      }
      return updated;
    },
  };
}

export type GoalsService = ReturnType<typeof createGoalsService>;
