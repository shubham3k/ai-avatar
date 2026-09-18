import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  calendarEventsQuerySchema,
  calendarEventsResponseSchema,
  calendarSignalDetectionQuerySchema,
  calendarSignalDetectionResponseSchema,
  calendarSyncResponseSchema,
  storedCalendarEventsQuerySchema,
  storedCalendarEventsResponseSchema,
} from "@ai-agent/shared";
import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { createCalendarEventsRepository } from "../db/repositories/calendar-events.repository.js";
import { createCalendarEventsService } from "../domain/calendar-events.service.js";
import { createCalendarSignalDetectionService } from "../domain/calendar-signal-detection.service.js";
import { createCalendarSyncService } from "../domain/calendar-sync.service.js";
import { validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const calendarEventsService = createCalendarEventsService();
const calendarSyncService = createCalendarSyncService();
const calendarSignalDetectionService = createCalendarSignalDetectionService();
const calendarEventsRepository = createCalendarEventsRepository(prisma);

const STORED_EVENTS_DEFAULT_LIMIT = 10;

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

export const googleCalendarRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/events",
    {
      schema: {
        querystring: calendarEventsQuerySchema,
        response: { 200: calendarEventsResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to fetch calendar events for.");
      }
      const events = await calendarEventsService.listUpcomingEvents(
        callerId,
        request.query.limit,
      );
      return { events };
    },
  );

  app.post(
    "/sync",
    {
      schema: {
        querystring: calendarEventsQuerySchema,
        response: { 200: calendarSyncResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to sync calendar events for.");
      }
      return calendarSyncService.sync(callerId, request.query.limit);
    },
  );

  app.post(
    "/detect-signals",
    {
      schema: {
        querystring: calendarSignalDetectionQuerySchema,
        response: { 200: calendarSignalDetectionResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to detect calendar signals for.");
      }
      return calendarSignalDetectionService.detectAndCreateInterventions(
        callerId,
        request.query.limit,
      );
    },
  );

  app.get(
    "/stored-events",
    {
      schema: {
        querystring: storedCalendarEventsQuerySchema,
        response: { 200: storedCalendarEventsResponseSchema },
      },
    },
    async (request) => {
      const callerId = await resolveCallerId(request);
      if (!callerId) {
        throw validationError("No user is available to list stored events for.");
      }
      const limit = request.query.limit ?? STORED_EVENTS_DEFAULT_LIMIT;
      const stored = await calendarEventsRepository.listUpcoming(callerId, limit);
      return {
        events: stored.map((event) => ({
          id: event.id,
          calendarId: event.calendarId,
          summary: event.title,
          description: event.description,
          location: event.location,
          start: event.isAllDay
            ? event.startAt.toISOString().slice(0, 10)
            : event.startAt.toISOString(),
          end: event.isAllDay
            ? event.endAt.toISOString().slice(0, 10)
            : event.endAt.toISOString(),
          isAllDay: event.isAllDay,
          attendees: Array.isArray(event.attendees)
            ? (event.attendees as unknown as {
                email: string | null;
                displayName: string | null;
                responseStatus: string | null;
              }[])
            : [],
          organizer: event.organizerEmail
            ? { email: event.organizerEmail, displayName: event.organizerName }
            : null,
          status: event.status,
          htmlLink: event.sourceUrl,
        })),
      };
    },
  );
};
