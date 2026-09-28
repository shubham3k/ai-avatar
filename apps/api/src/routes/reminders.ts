import type { Reminder } from "@prisma/client";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  createReminderFromTextRequestSchema,
  createReminderFromVoiceRequestSchema,
  createReminderRequestSchema,
  deleteReminderResponseSchema,
  idParamsSchema,
  reminderDetectionQuerySchema,
  reminderDetectionResponseSchema,
  reminderDtoSchema,
  remindersResponseSchema,
} from "@ai-agent/shared";
import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { createReminderDetectionService } from "../domain/reminder-detection.service.js";
import { createRemindersService } from "../domain/reminders.service.js";
import { validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const remindersService = createRemindersService();
const reminderDetectionService = createReminderDetectionService();

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

function toReminderDto(reminder: Reminder) {
  return {
    id: reminder.id,
    text: reminder.text,
    dueAt: reminder.dueAt.toISOString(),
    remindAt: reminder.remindAt ? reminder.remindAt.toISOString() : null,
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
  };
}

export const remindersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/",
    {
      schema: {
        body: createReminderRequestSchema,
        response: { 200: reminderDtoSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to create a reminder for.");
      }
      const reminder = await remindersService.createReminder(callerId, request.body);
      return toReminderDto(reminder);
    },
  );

  app.post(
    "/from-text",
    {
      schema: {
        body: createReminderFromTextRequestSchema,
        response: { 200: reminderDtoSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to create a reminder for.");
      }
      const reminder = await remindersService.createReminderFromText(callerId, request.body);
      return toReminderDto(reminder);
    },
  );

  app.post(
    "/from-voice",
    {
      // Base64 JSON inflates a short recording to a few hundred KB at
      // most; this headroom is just to avoid a surprise 413 on a longer
      // clip, not an invitation to upload arbitrary large files.
      bodyLimit: 10 * 1024 * 1024,
      schema: {
        body: createReminderFromVoiceRequestSchema,
        response: { 200: reminderDtoSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to create a reminder for.");
      }
      const reminder = await remindersService.createReminderFromVoice(callerId, request.body);
      return toReminderDto(reminder);
    },
  );

  app.get(
    "/",
    {
      schema: {
        response: { 200: remindersResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to list reminders for.");
      }
      const reminders = await remindersService.listReminders(callerId);
      return { reminders: reminders.map(toReminderDto) };
    },
  );

  app.delete(
    "/:id",
    {
      schema: {
        params: idParamsSchema,
        response: { 200: deleteReminderResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to delete a reminder for.");
      }
      await remindersService.deleteReminder(callerId, request.params.id);
      return { deleted: true as const };
    },
  );

  app.post(
    "/detect-signals",
    {
      schema: {
        querystring: reminderDetectionQuerySchema,
        response: { 200: reminderDetectionResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to detect reminder signals for.");
      }
      return reminderDetectionService.detectAndCreateInterventions(
        callerId,
        request.query.limit,
      );
    },
  );
};
