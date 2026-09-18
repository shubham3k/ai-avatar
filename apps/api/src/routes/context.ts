import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  consolidatedSituationsResponseSchema,
  crossSourceContextResponseSchema,
  dailyContextResponseSchema,
} from "@ai-agent/shared";
import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { createConsolidatedSituationsService } from "../domain/consolidated-situations.service.js";
import { createCrossSourceContextService } from "../domain/cross-source-context.service.js";
import { createDailyContextService } from "../domain/daily-context.service.js";
import { validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const crossSourceContextService = createCrossSourceContextService();
const consolidatedSituationsService = createConsolidatedSituationsService();
const dailyContextService = createDailyContextService();

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

export const contextRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/cross-source",
    {
      schema: {
        response: { 200: crossSourceContextResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to build context for.");
      }
      const contexts = await crossSourceContextService.getContext(callerId);
      return { contexts };
    },
  );

  app.get(
    "/situations",
    {
      schema: {
        response: { 200: consolidatedSituationsResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to evaluate situations for.");
      }
      const situations = await consolidatedSituationsService.getSituations(callerId);
      return { situations };
    },
  );

  app.get(
    "/daily",
    {
      schema: {
        response: { 200: dailyContextResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to build daily context for.");
      }
      return dailyContextService.getDailyContext(callerId);
    },
  );
};
