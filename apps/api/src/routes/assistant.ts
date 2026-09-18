import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { assistantEvaluationResponseSchema } from "@ai-agent/shared";
import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { createAssistantEvaluationService } from "../domain/assistant-evaluation.service.js";
import { upstreamError, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const assistantEvaluationService = createAssistantEvaluationService();

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

export const assistantRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/evaluate",
    {
      schema: {
        response: { 200: assistantEvaluationResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to evaluate the assistant for.");
      }

      const outcome = await assistantEvaluationService.evaluate(callerId);

      if (!outcome.ok) {
        if (outcome.code === "not_configured") {
          throw validationError(outcome.message);
        }
        throw upstreamError(outcome.message);
      }

      return { results: outcome.results };
    },
  );
};
