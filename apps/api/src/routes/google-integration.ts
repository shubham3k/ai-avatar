import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { googleConnectionStatusSchema } from "@ai-agent/shared";
import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { createGoogleConnectionService } from "../domain/google-connection.service.js";
import { validationError } from "../lib/errors.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

const googleConnectionService = createGoogleConnectionService();

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

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export const googleIntegrationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/connect", async (request, reply) => {
    const callerId = await resolveCallerId(request);
    if (!callerId) {
      throw validationError("No user is available to connect Google for.");
    }
    let url: string;
    try {
      url = googleConnectionService.startConnect(callerId);
    } catch (err) {
      throw validationError(
        err instanceof Error ? err.message : "Google OAuth is not configured.",
      );
    }
    return reply.redirect(url);
  });

  app.get(
    "/callback",
    { schema: { querystring: callbackQuerySchema } },
    async (request, reply) => {
      const { code, state, error } = request.query;

      if (error) {
        app.log.warn({ err: error }, "Google OAuth returned an error");
        return reply.redirect(
          `${env.APP_BASE_URL}/integrations/google?status=error`,
        );
      }

      if (!code || !state) {
        return reply.redirect(
          `${env.APP_BASE_URL}/integrations/google?status=error`,
        );
      }

      try {
        await googleConnectionService.handleCallback(state, code);
        return reply.redirect(
          `${env.APP_BASE_URL}/integrations/google?status=connected`,
        );
      } catch (err) {
        app.log.error(
          { err: err instanceof Error ? err.message : "unknown" },
          "Google OAuth callback failed",
        );
        return reply.redirect(
          `${env.APP_BASE_URL}/integrations/google?status=error`,
        );
      }
    },
  );

  app.get(
    "/status",
    { schema: { response: { 200: googleConnectionStatusSchema } } },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        return {
          connected: false,
          provider: "google" as const,
          email: null,
          scopes: [],
        };
      }
      return googleConnectionService.getStatus(callerId);
    },
  );

  app.post(
    "/disconnect",
    { schema: { response: { 200: googleConnectionStatusSchema } } },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to disconnect Google for.");
      }
      return googleConnectionService.disconnect(callerId);
    },
  );
};
