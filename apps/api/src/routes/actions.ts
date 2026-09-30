import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  actionDtoSchema,
  actionSettingsSchema,
  actionsResponseSchema,
  approveActionRequestSchema,
  executeDueResponseSchema,
  idParamsSchema,
  updateActionSettingsSchema,
} from "@ai-agent/shared";
import { getActionsService } from "../domain/actions/actions.service.js";
import { createGoogleConnectionService } from "../domain/google-connection.service.js";
import { prisma } from "../lib/prisma.js";
import { grantedCapabilities } from "../providers/google/oauth/google-oauth.types.js";
import { requireCaller } from "./caller.js";

/**
 * ADR-006 (M7): approval cards. Approve/cancel arrive only from the user's
 * click in the desktop app — Zara's own tools can propose, and approve
 * nothing but own-calendar-only changes the user confirmed in chat.
 */
export const actionsRoutes: FastifyPluginAsyncZod = async (app) => {
  const actions = getActionsService();
  const connection = createGoogleConnectionService();

  app.get("/", { schema: { response: { 200: actionsResponseSchema } } }, async (request) => ({
    actions: await actions.list(await requireCaller(request)),
  }));

  app.post(
    "/:id/approve",
    { schema: { params: idParamsSchema, body: approveActionRequestSchema, response: { 200: actionDtoSchema } } },
    async (request) =>
      actions.approve(await requireCaller(request), request.params.id, {
        via: "click",
        ...(request.body.payload !== undefined ? { payload: request.body.payload } : {}),
      }),
  );

  app.post("/:id/cancel", { schema: { params: idParamsSchema, response: { 200: actionDtoSchema } } }, async (request) =>
    actions.cancel(await requireCaller(request), request.params.id),
  );

  // Backup for the in-process 30 s timer (the desktop's 15 s delivery tick calls it).
  app.post("/execute-due", { schema: { response: { 200: executeDueResponseSchema } } }, async () => ({
    executed: await actions.executeDue(),
  }));

  app.get("/settings", { schema: { response: { 200: actionSettingsSchema } } }, async (request) => {
    const userId = await requireCaller(request);
    const [settings, status] = await Promise.all([
      prisma.actionSettings.findUnique({ where: { userId } }),
      connection.getStatus(userId),
    ]);
    return {
      writingStyle: settings?.writingStyle ?? "",
      permissions: { connected: status.connected, ...grantedCapabilities(status.scopes) },
    };
  });

  app.patch("/settings", { schema: { body: updateActionSettingsSchema, response: { 200: actionSettingsSchema } } }, async (request) => {
    const userId = await requireCaller(request);
    await prisma.actionSettings.upsert({
      where: { userId },
      update: { writingStyle: request.body.writingStyle.trim() },
      create: { userId, writingStyle: request.body.writingStyle.trim() },
    });
    const status = await connection.getStatus(userId);
    return {
      writingStyle: request.body.writingStyle.trim(),
      permissions: { connected: status.connected, ...grantedCapabilities(status.scopes) },
    };
  });
};
