import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  doneRequestSchema,
  idParamsSchema,
  inboxResponseSchema,
  interventionDtoSchema,
  snoozeRequestSchema,
} from "@ai-agent/shared";
import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { createInterventionService } from "../domain/intervention.service.js";
import { prisma } from "../lib/prisma.js";
import { toInterventionDto } from "./intervention.dto.js";

const interventionService = createInterventionService();

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

export const interventionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: {
        response: { 200: inboxResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      const items = await interventionService.listInbox(callerId);
      return { items: items.map(toInterventionDto) };
    },
  );

  app.get(
    "/:id",
    {
      schema: {
        params: idParamsSchema,
        response: { 200: interventionDtoSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      const intervention = await interventionService.getById(
        callerId,
        request.params.id,
      );
      return toInterventionDto(intervention);
    },
  );

  app.post(
    "/:id/done",
    {
      schema: {
        params: idParamsSchema,
        body: doneRequestSchema,
        response: { 200: interventionDtoSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      const intervention = await interventionService.done(
        callerId,
        request.params.id,
      );
      return toInterventionDto(intervention);
    },
  );

  app.post(
    "/:id/snooze",
    {
      schema: {
        params: idParamsSchema,
        body: snoozeRequestSchema,
        response: { 200: interventionDtoSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      const intervention = await interventionService.snooze(
        callerId,
        request.params.id,
        request.body.minutes,
      );
      return toInterventionDto(intervention);
    },
  );
};
