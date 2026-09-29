import fastify from "fastify";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.js";
import { interventionRoutes } from "./routes/interventions.js";
import { googleIntegrationRoutes } from "./routes/google-integration.js";
import { googleGmailRoutes } from "./routes/google-gmail.js";
import { googleCalendarRoutes } from "./routes/google-calendar.js";
import { contextRoutes } from "./routes/context.js";
import { prioritizationRoutes } from "./routes/prioritization.js";
import { assistantRoutes } from "./routes/assistant.js";
import { goalsRoutes } from "./routes/goals.js";
import { remindersRoutes } from "./routes/reminders.js";
import { usageRoutes } from "./routes/usage.js";
import { chatRoutes } from "./routes/chat.js";
import { memoryRoutes } from "./routes/memory.js";
import { activityRoutes } from "./routes/activity.js";
import { ensureDemoUser } from "./demo/demo-scenario.js";
import { prisma } from "./lib/prisma.js";

export function buildApp() {
  const app = fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "info" : "warn",
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler(
    (error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (error.validation || error.statusCode === 400) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: error.message,
        },
      });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: {
          code: "client_error",
          message: error.message,
        },
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    });
    },
  );

  app.register(healthRoutes, { prefix: "/api/v1" });
  app.register(interventionRoutes, { prefix: "/api/v1/interventions" });
  app.register(googleIntegrationRoutes, { prefix: "/api/v1/integrations/google" });
  app.register(googleGmailRoutes, { prefix: "/api/v1/integrations/google/gmail" });
  app.register(googleCalendarRoutes, { prefix: "/api/v1/integrations/google/calendar" });
  app.register(contextRoutes, { prefix: "/api/v1/context" });
  app.register(prioritizationRoutes, { prefix: "/api/v1/prioritization" });
  app.register(assistantRoutes, { prefix: "/api/v1/assistant" });
  app.register(goalsRoutes, { prefix: "/api/v1/goals" });
  app.register(remindersRoutes, { prefix: "/api/v1/reminders" });
  app.register(usageRoutes, { prefix: "/api/v1/usage" });
  app.register(chatRoutes, { prefix: "/api/v1/chat" });
  app.register(memoryRoutes, { prefix: "/api/v1/memory" });
  app.register(activityRoutes, { prefix: "/api/v1/activity" });

  // This app is single-user (see ensureDemoUser's own comment) — every
  // route needs this row to exist before it can do anything. Runs on
  // every start, not just a one-time seed, and resolves before listen()
  // does, so no request can race it.
  app.addHook("onReady", async () => {
    await ensureDemoUser(prisma);
  });

  return app;
}
