import {
  createCalendarEventsRepository,
  type CalendarEventsRepository,
} from "../db/repositories/calendar-events.repository.js";
import {
  createInterventionsRepository,
  createSignalsRepository,
  type InterventionsRepository,
  type SignalsRepository,
} from "../db/repositories/interventions.repository.js";
import { prisma } from "../lib/prisma.js";
import { detectUpcomingMeeting } from "./signals/calendar/upcoming-meeting.detector.js";
import type { UpcomingMeetingAttendee } from "./signals/calendar/upcoming-meeting.types.js";

export const CALENDAR_SIGNAL_DETECTION_DEFAULT_LIMIT = 10;
export const CALENDAR_SIGNAL_DETECTION_MAX_LIMIT = 25;

export interface CalendarSignalDetectionResult {
  analyzed: number;
  actionable: number;
  signalsCreated: number;
  interventionsCreated: number;
}

export function clampCalendarDetectionLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return CALENDAR_SIGNAL_DETECTION_DEFAULT_LIMIT;
  }
  return Math.max(
    1,
    Math.min(Math.trunc(requested), CALENDAR_SIGNAL_DETECTION_MAX_LIMIT),
  );
}

const AVAILABLE_ACTIONS = ["DONE", "REMIND_LATER"];

function meetingTitle(title: string | null): string {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Upcoming meeting";
}

export function createCalendarSignalDetectionService(dependencies?: {
  events?: CalendarEventsRepository;
  signals?: SignalsRepository;
  interventions?: InterventionsRepository;
}) {
  const events = dependencies?.events ?? createCalendarEventsRepository(prisma);
  const signals = dependencies?.signals ?? createSignalsRepository(prisma);
  const interventions =
    dependencies?.interventions ?? createInterventionsRepository(prisma);

  return {
    async detectAndCreateInterventions(
      userId: string,
      requestedLimit?: number,
      now: Date = new Date(),
    ): Promise<CalendarSignalDetectionResult> {
      const limit = clampCalendarDetectionLimit(requestedLimit);
      // Already filtered to startAt >= now by the repository, ordered soonest-first.
      const upcomingEvents = await events.listUpcoming(userId, limit, now);

      let actionableCount = 0;
      let signalsCreated = 0;
      let interventionsCreated = 0;

      for (const event of upcomingEvents) {
        const detection = detectUpcomingMeeting(
          {
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            isAllDay: event.isAllDay,
            status: event.status,
            organizerEmail: event.organizerEmail,
            organizerName: event.organizerName,
            attendees: Array.isArray(event.attendees)
              ? (event.attendees as unknown as UpcomingMeetingAttendee[])
              : [],
          },
          now,
        );

        if (!detection.actionable || !detection.confidence) continue;
        actionableCount += 1;

        let signal = await signals.findUniqueKey(
          userId,
          "user_action_required",
          "calendar_event",
          event.id,
        );
        if (!signal) {
          signal = await signals.create({
            userId,
            type: "user_action_required",
            sourceType: "calendar_event",
            sourceId: event.id,
            title: meetingTitle(event.title),
            summary: detection.reason,
            dueAt: event.startAt,
            importanceHints: {
              confidence: detection.confidence,
              minutesUntilStart: detection.minutesUntilStart,
              calendarEventId: event.id,
              providerEventId: event.providerEventId,
            },
          });
          signalsCreated += 1;
        }

        const existingIntervention = await interventions.findBySignalId(signal.id);
        if (!existingIntervention) {
          await interventions.create({
            userId,
            signalId: signal.id,
            priority: detection.confidence === "high" ? "high" : "medium",
            title: meetingTitle(event.title),
            message: detection.reason,
            reason: detection.reason,
            actionType: "open_source",
            actionPayload: {
              sourceUrl: event.sourceUrl,
              availableActions: AVAILABLE_ACTIONS,
            },
          });
          interventionsCreated += 1;
        }
      }

      return {
        analyzed: upcomingEvents.length,
        actionable: actionableCount,
        signalsCreated,
        interventionsCreated,
      };
    },
  };
}

export type CalendarSignalDetectionService = ReturnType<
  typeof createCalendarSignalDetectionService
>;
