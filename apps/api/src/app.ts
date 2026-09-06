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

  return app;
}
