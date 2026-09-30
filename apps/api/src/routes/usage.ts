import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { llmUsageSummaryResponseSchema } from "@ai-agent/shared";
import { createLlmUsageService } from "../domain/llm-usage.service.js";

/** ADR-006: "usage this month" for Settings — estimated from recorded token/audio counts. */
export const usageRoutes: FastifyPluginAsyncZod = async (app) => {
  const usageService = createLlmUsageService();

  app.get(
    "/summary",
    { schema: { response: { 200: llmUsageSummaryResponseSchema } } },
    async () => usageService.summary(),
  );
};
