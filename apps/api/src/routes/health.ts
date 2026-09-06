import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { healthResponseSchema } from "@ai-agent/shared";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({
      status: "ok" as const,
      timestamp: new Date().toISOString(),
      service: "api",
    }),
  );

  app.get(
    "/ready",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({
      status: "ok" as const,
      timestamp: new Date().toISOString(),
      service: "api",
    }),
  );
};