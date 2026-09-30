import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  createRoutineRequestSchema,
  deletedCountResponseSchema,
  idParamsSchema,
  recallIndexResponseSchema,
  routineDtoSchema,
  routinesResponseSchema,
  runDueResponseSchema,
  updateRoutineRequestSchema,
} from "@ai-agent/shared";
import { getRoutinesService } from "../domain/routines/routines.service.js";
import { requireCaller } from "./caller.js";

/** ADR-006 (M9): routines — Settings → Routines and the desktop's scheduler tick. */
export const routinesRoutes: FastifyPluginAsyncZod = async (app) => {
  const routines = getRoutinesService();

  app.get("/", { schema: { response: { 200: routinesResponseSchema } } }, async (request) => ({
    routines: await routines.list(await requireCaller(request)),
  }));

  app.post("/", { schema: { body: createRoutineRequestSchema, response: { 200: routineDtoSchema } } }, async (request) =>
    routines.create(await requireCaller(request), request.body.text),
  );

  app.patch(
    "/:id",
    { schema: { params: idParamsSchema, body: updateRoutineRequestSchema, response: { 200: routineDtoSchema } } },
    async (request) => routines.update(await requireCaller(request), request.params.id, request.body),
  );

  app.delete("/:id", { schema: { params: idParamsSchema, response: { 200: deletedCountResponseSchema } } }, async (request) => {
    await routines.remove(await requireCaller(request), request.params.id);
    return { deleted: 1 };
  });

  app.post("/:id/run", { schema: { params: idParamsSchema, response: { 200: recallIndexResponseSchema } } }, async (request) =>
    routines.runNow(await requireCaller(request), request.params.id),
  );

  // Called by the desktop's delivery tick; due routines run in the background.
  app.post("/run-due", { schema: { response: { 200: runDueResponseSchema } } }, async () => ({
    started: await routines.runDue(),
  }));
};
