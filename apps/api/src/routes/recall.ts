import { isAbsolute } from "node:path";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  recallIndexResponseSchema,
  recallSearchQuerySchema,
  recallSearchResponseSchema,
  recallSettingsSchema,
  recallStatusSchema,
  updateRecallSettingsSchema,
} from "@ai-agent/shared";
import { getRecallService } from "../domain/recall/recall.service.js";
import { validationError } from "../lib/errors.js";
import { requireCaller } from "./caller.js";

/** ADR-006 (M6): recall settings, index status, background indexing, search. */
export const recallRoutes: FastifyPluginAsyncZod = async (app) => {
  const recall = getRecallService();

  app.get("/settings", { schema: { response: { 200: recallSettingsSchema } } }, async (request) =>
    recall.settings(await requireCaller(request)),
  );

  app.patch(
    "/settings",
    { schema: { body: updateRecallSettingsSchema, response: { 200: recallSettingsSchema } } },
    async (request) => {
      const userId = await requireCaller(request);
      const folder = request.body.documentsFolder;
      if (typeof folder === "string" && !isAbsolute(folder)) throw validationError("Choose a full folder path.");
      const updated = await recall.updateSettings(userId, request.body);
      recall.start(userId);
      return updated;
    },
  );

  app.get("/status", { schema: { response: { 200: recallStatusSchema } } }, async (request) =>
    recall.status(await requireCaller(request)),
  );

  // Returns at once; indexing continues in the background (one pass at a time).
  app.post("/index", { schema: { response: { 200: recallIndexResponseSchema } } }, async (request) =>
    recall.start(await requireCaller(request)),
  );

  app.get(
    "/search",
    { schema: { querystring: recallSearchQuerySchema, response: { 200: recallSearchResponseSchema } } },
    async (request) => {
      const hits = await recall.search(await requireCaller(request), request.query.q, { limit: request.query.limit ?? 8 });
      return {
        results: hits.map((hit) => ({
          id: hit.id,
          sourceType: hit.sourceType,
          title: hit.title,
          snippet: hit.text.slice(0, 300),
          sourceDate: hit.sourceDate?.toISOString() ?? null,
          url: hit.url,
        })),
      };
    },
  );
};
