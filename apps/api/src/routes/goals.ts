import type { Goal } from "@prisma/client";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  createGoalRequestSchema,
  goalDtoSchema,
  goalsQuerySchema,
  goalsResponseSchema,
  idParamsSchema,
  updateGoalRequestSchema,
} from "@ai-agent/shared";
import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { createGoalsService } from "../domain/goals.service.js";
import { validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const goalsService = createGoalsService();

async function resolveCallerId(request: { headers: Record<string, unknown> }) {
  const header = request.headers["x-user-id"];
  const callerId = typeof header === "string" ? header.trim() : "";
  if (callerId) return callerId;
  const demoUser = await prisma.user.findUnique({
    where: { email: DEMO_USER_EMAIL },
    select: { id: true },
  });
  return demoUser?.id ?? "";
}

function toGoalDto(goal: Goal) {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    active: goal.active,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

export const goalsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/",
    {
      schema: {
        body: createGoalRequestSchema,
        response: { 200: goalDtoSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to create a goal for.");
      }
      const goal = await goalsService.createGoal(callerId, request.body);
      return toGoalDto(goal);
    },
  );

  app.get(
    "/",
    {
      schema: {
        querystring: goalsQuerySchema,
        response: { 200: goalsResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to list goals for.");
      }
      const goals = await goalsService.listGoals(
        callerId,
        request.query.includeInactive ?? false,
      );
      return { goals: goals.map(toGoalDto) };
    },
  );

  app.patch(
    "/:id",
    {
      schema: {
        params: idParamsSchema,
        body: updateGoalRequestSchema,
        response: { 200: goalDtoSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to update a goal for.");
      }
      const goal = await goalsService.updateGoal(callerId, request.params.id, request.body);
      return toGoalDto(goal);
    },
  );
};
