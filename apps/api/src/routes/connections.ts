import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  addConnectionRequestSchema,
  connectionDtoSchema,
  connectionsResponseSchema,
  deletedCountResponseSchema,
  idParamsSchema,
  toolPolicyParamsSchema,
  toolPolicyRequestSchema,
  updateConnectionRequestSchema,
} from "@ai-agent/shared";
import { getConnectionsService } from "../domain/mcp/connections.service.js";
import { requireCaller } from "./caller.js";

/** ADR-006 (M8): the user's connections. Only the user adds them — Zara has no tool for it. */
export const connectionsRoutes: FastifyPluginAsyncZod = async (app) => {
  const connections = getConnectionsService();
  const presets = connections.presets.map(({ id, name, description, runtime, secrets, needsFolders, note }) => ({
    id,
    name,
    description,
    runtime,
    secrets,
    ...(needsFolders ? { needsFolders } : {}),
    ...(note ? { note } : {}),
  }));

  app.addHook("onClose", async () => {
    await connections.stopAll();
  });

  app.get("/", { schema: { response: { 200: connectionsResponseSchema } } }, async (request) => ({
    presets,
    connections: await connections.list(await requireCaller(request)),
  }));

  app.post("/", { schema: { body: addConnectionRequestSchema, response: { 200: connectionDtoSchema } } }, async (request) =>
    connections.add(await requireCaller(request), request.body),
  );

  app.patch(
    "/:id",
    { schema: { params: idParamsSchema, body: updateConnectionRequestSchema, response: { 200: connectionDtoSchema } } },
    async (request) => connections.update(await requireCaller(request), request.params.id, request.body),
  );

  app.post("/:id/restart", { schema: { params: idParamsSchema, response: { 200: connectionDtoSchema } } }, async (request) =>
    connections.restart(await requireCaller(request), request.params.id),
  );

  app.delete("/:id", { schema: { params: idParamsSchema, response: { 200: deletedCountResponseSchema } } }, async (request) => {
    await connections.remove(await requireCaller(request), request.params.id);
    return { deleted: 1 };
  });

  app.put(
    "/:id/tools/:tool",
    { schema: { params: toolPolicyParamsSchema, body: toolPolicyRequestSchema, response: { 200: connectionDtoSchema } } },
    async (request) => connections.setToolPolicy(await requireCaller(request), request.params.id, request.params.tool, request.body),
  );
};
