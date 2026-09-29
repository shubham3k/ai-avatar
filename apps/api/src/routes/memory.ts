import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  deletedCountResponseSchema,
  idParamsSchema,
  memoryFactDtoSchema,
  memoryFactsResponseSchema,
  updateMemoryFactRequestSchema,
} from "@ai-agent/shared";
import { createMemoryService } from "../domain/memory/memory.service.js";
import { requireCaller } from "./caller.js";

/** ADR-006 (M3): the Settings memory page — everything Zara remembers, editable and deletable. */
export const memoryRoutes: FastifyPluginAsyncZod = async (app) => {
  const memory = createMemoryService();

  app.get("/facts", { schema: { response: { 200: memoryFactsResponseSchema } } }, async (request) => ({
    facts: await memory.list(await requireCaller(request)),
  }));

  app.patch(
    "/facts/:id",
    { schema: { params: idParamsSchema, body: updateMemoryFactRequestSchema, response: { 200: memoryFactDtoSchema } } },
    async (request) => (await memory.update(await requireCaller(request), request.params.id, request.body.content)).fact,
  );

  app.delete(
    "/facts/:id",
    { schema: { params: idParamsSchema, response: { 200: memoryFactDtoSchema } } },
    async (request) => memory.delete(await requireCaller(request), request.params.id),
  );

  app.delete("/facts", { schema: { response: { 200: deletedCountResponseSchema } } }, async (request) => ({
    deleted: await memory.deleteAll(await requireCaller(request)),
  }));
};
