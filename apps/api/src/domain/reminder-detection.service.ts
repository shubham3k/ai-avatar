import {
  createRemindersRepository,
  type RemindersRepository,
} from "../db/repositories/reminders.repository.js";
import {
  createInterventionsRepository,
  createSignalsRepository,
  type InterventionsRepository,
  type SignalsRepository,
} from "../db/repositories/interventions.repository.js";
import { prisma } from "../lib/prisma.js";

export const REMINDER_DETECTION_DEFAULT_LIMIT = 10;
export const REMINDER_DETECTION_MAX_LIMIT = 25;

export interface ReminderDetectionResult {
  analyzed: number;
  interventionsCreated: number;
}

export function clampReminderDetectionLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return REMINDER_DETECTION_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(Math.trunc(requested), REMINDER_DETECTION_MAX_LIMIT));
}

const TITLE_MAX_LENGTH = 60;

function reminderTitle(text: string): string {
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text;
}

/** For heads-up reminders that fire before their event ("meeting at 5pm" → alert at 4:50), say how far away it is; direct pings fire at dueAt and need no suffix. */
function reminderMessage(text: string, dueAt: Date, now: Date): string {
  const minutesUntilDue = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  if (minutesUntilDue < 1) return text;
  return `${text} — in ${minutesUntilDue} minute${minutesUntilDue === 1 ? "" : "s"}.`;
}

/**
 * Unlike Gmail/Calendar detection, there's no confidence tiering here — a
 * reminder is either due (dueAt <= now) or it isn't; the user already
 * decided it was worth being reminded about when they created it. Always
 * "medium" priority: a self-authored reminder deserves attention, but
 * there's no signal here to justify "high"/"critical" automatically.
 */
export function createReminderDetectionService(dependencies?: {
  reminders?: RemindersRepository;
  signals?: SignalsRepository;
  interventions?: InterventionsRepository;
}) {
  const reminders = dependencies?.reminders ?? createRemindersRepository(prisma);
  const signals = dependencies?.signals ?? createSignalsRepository(prisma);
  const interventions =
    dependencies?.interventions ?? createInterventionsRepository(prisma);

  return {
    async detectAndCreateInterventions(
      userId: string,
      requestedLimit?: number,
      now: Date = new Date(),
    ): Promise<ReminderDetectionResult> {
      const limit = clampReminderDetectionLimit(requestedLimit);
      const dueReminders = await reminders.listDue(userId, now, limit);

      let interventionsCreated = 0;

      for (const reminder of dueReminders) {
        let signal = await signals.findUniqueKey(
          userId,
          "user_action_required",
          "reminder",
          reminder.id,
        );
        if (!signal) {
          signal = await signals.create({
            userId,
            type: "user_action_required",
            sourceType: "reminder",
            sourceId: reminder.id,
            title: reminderTitle(reminder.text),
            summary: reminder.text,
            dueAt: reminder.dueAt,
            importanceHints: { reminderId: reminder.id },
          });
        }

        const existingIntervention = await interventions.findBySignalId(signal.id);
        if (!existingIntervention) {
          await interventions.create({
            userId,
            signalId: signal.id,
            priority: "medium",
            title: reminderTitle(reminder.text),
            message: reminderMessage(reminder.text, reminder.dueAt, now),
            reason: reminder.text,
            actionType: "none",
            actionPayload: null,
          });
          interventionsCreated += 1;
        }
      }

      return {
        analyzed: dueReminders.length,
        interventionsCreated,
      };
    },
  };
}

export type ReminderDetectionService = ReturnType<typeof createReminderDetectionService>;
