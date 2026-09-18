import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { prioritizationResponseSchema } from "@ai-agent/shared";
import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { createSituationPrioritizationService } from "../domain/situation-prioritization.service.js";
import { upstreamError, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const situationPrioritizationService = createSituationPrioritizationService();

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

export const prioritizationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: {
        response: { 200: prioritizationResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to prioritize situations for.");
      }

      const outcome = await situationPrioritizationService.prioritize(callerId);

      if (!outcome.ok) {
        if (outcome.code === "not_configured") {
          throw validationError(outcome.message);
        }
        // "provider_error" and "malformed_output" are both the external
        // provider's fault from the caller's point of view.
        throw upstreamError(outcome.message);
      }

      return { prioritizedSituations: outcome.prioritizedSituations };
    },
  );
};
