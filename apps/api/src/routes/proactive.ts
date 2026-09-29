import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  deliverBriefingRequestSchema,
  deliverBriefingResponseSchema,
  proactiveSettingsSchema,
  sentMailProcessResponseSchema,
  updateProactiveSettingsSchema,
} from "@ai-agent/shared";
import { createBriefingService } from "../domain/proactive/briefing.service.js";
import {
  createProactiveSettingsService,
  toProactiveSettingsDto,
} from "../domain/proactive/proactive-settings.service.js";
import { createSentMailService } from "../domain/proactive/sent-mail.service.js";
import { requireCaller } from "./caller.js";

const settings = createProactiveSettingsService();
const briefings = createBriefingService();
const sentMail = createSentMailService();

/** ADR-006 (M5): proactive settings, briefings/wrap-ups, and sent-mail follow-ups/promises. */
export const proactiveRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/settings", { schema: { response: { 200: proactiveSettingsSchema } } }, async (request) =>
    toProactiveSettingsDto(await settings.get(await requireCaller(request))),
  );

  app.patch(
    "/settings",
    { schema: { body: updateProactiveSettingsSchema, response: { 200: proactiveSettingsSchema } } },
    async (request) => toProactiveSettingsDto(await settings.update(await requireCaller(request), request.body)),
  );

  app.post(
    "/briefing",
    { schema: { body: deliverBriefingRequestSchema, response: { 200: deliverBriefingResponseSchema } } },
    async (request) =>
      briefings.deliver(await requireCaller(request), request.body.kind, { force: request.body.force === true }),
  );

  app.post("/sent-mail", { schema: { response: { 200: sentMailProcessResponseSchema } } }, async (request) =>
    sentMail.process(await requireCaller(request)),
  );
};
