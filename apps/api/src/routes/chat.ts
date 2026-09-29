import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  chatMessagesResponseSchema,
  conversationsResponseSchema,
  deletedCountResponseSchema,
  idParamsSchema,
  sendChatMessageRequestSchema,
  speakRequestSchema,
  speakResponseSchema,
  transcribeRequestSchema,
  transcribeResponseSchema,
} from "@ai-agent/shared";
import { createAudioTranscriptionService } from "../domain/audio-transcription.service.js";
import { createSpeechService } from "../domain/speech/speech.service.js";
import { createZaraAgentService, type ChatEvent } from "../domain/chat/zara-agent.service.js";
import { upstreamError, validationError } from "../lib/errors.js";
import { requireCaller } from "./caller.js";

const agent = createZaraAgentService();
const transcription = createAudioTranscriptionService();
const speech = createSpeechService();

/** ADR-006 (M2): Zara chat. Replies stream as Server-Sent Events — one JSON ChatEvent per `data:` line. */
export const chatRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post("/messages", { schema: { body: sendChatMessageRequestSchema } }, async (request, reply) => {
    const userId = await requireCaller(request);
    // Validate the conversation before switching the response to a stream,
    // so a bad id still gets a normal 404 JSON error.
    if (request.body.conversationId && !request.body.incognito) {
      await agent.getMessages(userId, request.body.conversationId);
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const emit = (event: ChatEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await agent.sendMessage(userId, request.body, emit);
    } catch {
      emit({ type: "error", message: "Something went wrong. Please try again." });
    } finally {
      reply.raw.end();
    }
  });

  app.get("/conversations", { schema: { response: { 200: conversationsResponseSchema } } }, async (request) => {
    return { conversations: await agent.listConversations(await requireCaller(request)) };
  });

  app.delete(
    "/conversations/:id",
    { schema: { params: idParamsSchema, response: { 200: deletedCountResponseSchema } } },
    async (request) => {
      await agent.deleteConversation(await requireCaller(request), request.params.id);
      return { deleted: 1 };
    },
  );

  app.delete("/conversations", { schema: { response: { 200: deletedCountResponseSchema } } }, async (request) => ({
    deleted: await agent.deleteAllConversations(await requireCaller(request)),
  }));

  app.get(
    "/conversations/:id/messages",
    { schema: { params: idParamsSchema, response: { 200: chatMessagesResponseSchema } } },
    async (request) => ({
      messages: await agent.getMessages(await requireCaller(request), request.params.id),
    }),
  );

  app.post(
    "/transcribe",
    { bodyLimit: 10 * 1024 * 1024, schema: { body: transcribeRequestSchema, response: { 200: transcribeResponseSchema } } },
    async (request) => {
      await requireCaller(request);
      const audio = Buffer.from(request.body.audioBase64, "base64");
      if (audio.length === 0) throw validationError("No audio was recorded.");
      const outcome = await transcription.transcribe(
        audio,
        request.body.mimeType,
        request.body.durationSeconds,
        request.body.script ?? "latin",
      );
      if (!outcome.ok) {
        if (outcome.code === "auth_rejected" || outcome.code === "model_unavailable" || outcome.code === "provider_error") {
          throw upstreamError(outcome.message);
        }
        throw validationError(outcome.message);
      }
      return { text: outcome.text };
    },
  );

  // M4: one chunk of Zara's reply → MP3. A 400 when no OpenAI key is set
  // tells the desktop to use a local Windows voice instead.
  app.post(
    "/speak",
    { schema: { body: speakRequestSchema, response: { 200: speakResponseSchema } } },
    async (request) => {
      await requireCaller(request);
      const outcome = await speech.speak(request.body.text, request.body.voice);
      if (!outcome.ok) {
        if (outcome.code === "not_configured") throw validationError(outcome.message);
        throw upstreamError(outcome.message);
      }
      return { audioBase64: outcome.audio.toString("base64"), mimeType: "audio/mpeg" as const };
    },
  );
};
