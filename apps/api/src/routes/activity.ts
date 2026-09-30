import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  activityEntryDtoSchema,
  activityQuerySchema,
  activityResponseSchema,
  deletedCountResponseSchema,
  idParamsSchema,
} from "@ai-agent/shared";
import { createActivityService } from "../domain/activity/activity.service.js";
import { requireCaller } from "./caller.js";

/** ADR-006 (M3): the activity log — everything Zara did, with undo where possible. */
export const activityRoutes: FastifyPluginAsyncZod = async (app) => {
  const activity = createActivityService();

  app.get(
    "/",
    { schema: { querystring: activityQuerySchema, response: { 200: activityResponseSchema } } },
    async (request) => ({ entries: await activity.list(await requireCaller(request), request.query.limit) }),
  );

  app.post(
    "/:id/undo",
    { schema: { params: idParamsSchema, response: { 200: activityEntryDtoSchema } } },
    async (request) => activity.undo(await requireCaller(request), request.params.id),
  );

  app.delete("/", { schema: { response: { 200: deletedCountResponseSchema } } }, async (request) => ({
    deleted: await activity.clear(await requireCaller(request)),
  }));
};
