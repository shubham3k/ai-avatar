import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  gmailMessagesQuerySchema,
  gmailMessagesResponseSchema,
  gmailSignalDetectionQuerySchema,
  gmailSignalDetectionResponseSchema,
  gmailSyncResponseSchema,
  storedEmailsQuerySchema,
  storedEmailsResponseSchema,
} from "@ai-agent/shared";
import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { createEmailsRepository } from "../db/repositories/emails.repository.js";
import { createGmailMessagesService } from "../domain/gmail-messages.service.js";
import { createGmailSignalDetectionService } from "../domain/gmail-signal-detection.service.js";
import { createGmailSyncService } from "../domain/gmail-sync.service.js";
import { validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const gmailMessagesService = createGmailMessagesService();
const gmailSyncService = createGmailSyncService();
const gmailSignalDetectionService = createGmailSignalDetectionService();
const emailsRepository = createEmailsRepository(prisma);

const STORED_MESSAGES_DEFAULT_LIMIT = 10;

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

export const googleGmailRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/messages",
    {
      schema: {
        querystring: gmailMessagesQuerySchema,
        response: { 200: gmailMessagesResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to fetch Gmail for.");
      }
      const messages = await gmailMessagesService.listRecentMessages(
        callerId,
        request.query.limit,
      );
      return { messages };
    },
  );

  app.post(
    "/sync",
    {
      schema: {
        querystring: gmailMessagesQuerySchema,
        response: { 200: gmailSyncResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to sync Gmail for.");
      }
      return gmailSyncService.sync(callerId, request.query.limit);
    },
  );

  app.post(
    "/detect-signals",
    {
      schema: {
        querystring: gmailSignalDetectionQuerySchema,
        response: { 200: gmailSignalDetectionResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to detect signals for.");
      }
      return gmailSignalDetectionService.detectAndCreateInterventions(
        callerId,
        request.query.limit,
      );
    },
  );

  app.get(
    "/stored-messages",
    {
      schema: {
        querystring: storedEmailsQuerySchema,
        response: { 200: storedEmailsResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to list stored messages for.");
      }
      const limit = request.query.limit ?? STORED_MESSAGES_DEFAULT_LIMIT;
      const emails = await emailsRepository.listRecent(callerId, limit);
      return {
        messages: emails.map((email) => ({
          id: email.id,
          providerMessageId: email.providerMessageId,
          threadId: email.threadId,
          fromEmail: email.fromEmail,
          fromName: email.fromName,
          toEmails: email.toEmails,
          subject: email.subject,
          snippet: email.snippet,
          receivedAt: email.receivedAt.toISOString(),
          isRead: email.isRead,
          labels: email.labels,
          sourceUrl: email.sourceUrl,
        })),
      };
    },
  );
};
