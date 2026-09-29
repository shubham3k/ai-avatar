import type { Reminder } from "@prisma/client";
import {
  createRemindersRepository,
  type RemindersRepository,
} from "../db/repositories/reminders.repository.js";
import { notFoundError, upstreamError, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { REMINDER_TEXT_MAX_LENGTH } from "./reminders.constants.js";
import {
  createReminderParsingService,
  type ReminderParsingService,
} from "./reminder-parsing.service.js";
import {
  createAudioTranscriptionService,
  type AudioTranscriptionService,
} from "./audio-transcription.service.js";

export { REMINDER_TEXT_MAX_LENGTH };

export interface CreateReminderRequest {
  text: string;
  dueAt: string;
}

export interface CreateReminderFromTextRequest {
  text: string;
}

export interface CreateReminderFromVoiceRequest {
  /** Base64-encoded audio (no data: URI prefix). */
  audioBase64: string;
  mimeType: string;
  /** Recording length measured by the client — transcription is billed per minute (usage estimate only). */
  durationSeconds?: number | undefined;
}

function normalizeText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw validationError("Reminder text is required.");
  }
  if (trimmed.length > REMINDER_TEXT_MAX_LENGTH) {
    throw validationError(`Reminder text must be ${REMINDER_TEXT_MAX_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

function normalizeDueAt(dueAt: string, now: Date): Date {
  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) {
    throw validationError("Reminder due date is invalid.");
  }
  // A small grace window, not a strict ">= now": the picker's minute-level
  // precision plus request latency can easily land a "right now" reminder a
  // second or two in the past by the time this validates.
  if (parsed.getTime() < now.getTime() - 60_000) {
    throw validationError("Reminder due date must be in the future.");
  }
  return parsed;
}

/**
 * create/list/delete, via three creation paths:
 * - createReminder: the caller supplies an exact ISO due date/time (the
 *   Settings picker) — fires exactly at dueAt, no lead time.
 * - createReminderFromText: free text parsed by reminder-parsing.service.ts
 *   into text + dueAt + remindAt. "Remind me at 4pm" fires at 4pm exactly;
 *   "meeting at 5pm" fires 10 minutes early (ADR-005).
 * - createReminderFromVoice: a recorded clip, transcribed by Groq
 *   (audio-transcription.service.ts) and then run through the exact same
 *   free-text parsing path as createReminderFromText.
 */
export function createRemindersService(dependencies?: {
  reminders?: RemindersRepository;
  parsing?: ReminderParsingService;
  transcription?: AudioTranscriptionService;
}) {
  const reminders = dependencies?.reminders ?? createRemindersRepository(prisma);
  const parsing = dependencies?.parsing ?? createReminderParsingService();
  const transcription = dependencies?.transcription ?? createAudioTranscriptionService();

  async function createFromFreeText(
    userId: string,
    rawText: string,
    now: Date,
  ): Promise<Reminder> {
    const outcome = await parsing.parse(rawText, now);
    if (!outcome.ok) {
      // Provider-side failures are upstream (502); everything else is about
      // the user's input or setup (400). Either way the message is
      // user-facing and shown as-is by the desktop app.
      if (
        outcome.code === "auth_rejected" ||
        outcome.code === "model_unavailable" ||
        outcome.code === "provider_error"
      ) {
        throw upstreamError(outcome.message);
      }
      throw validationError(outcome.message);
    }

    return reminders.create({
      userId,
      text: outcome.reminderText,
      dueAt: outcome.dueAt,
      remindAt: outcome.remindAt,
    });
  }

  return {
    async createReminder(
      userId: string,
      request: CreateReminderRequest,
      now: Date = new Date(),
    ): Promise<Reminder> {
      const text = normalizeText(request.text);
      const dueAt = normalizeDueAt(request.dueAt, now);
      return reminders.create({ userId, text, dueAt });
    },

    async createReminderFromText(
      userId: string,
      request: CreateReminderFromTextRequest,
      now: Date = new Date(),
    ): Promise<Reminder> {
      const rawText = request.text.trim();
      if (rawText.length === 0) {
        throw validationError("Reminder text is required.");
      }
      return createFromFreeText(userId, rawText, now);
    },

    async createReminderFromVoice(
      userId: string,
      request: CreateReminderFromVoiceRequest,
      now: Date = new Date(),
    ): Promise<Reminder> {
      let audio: Buffer;
      try {
        audio = Buffer.from(request.audioBase64, "base64");
      } catch {
        throw validationError("Invalid audio data.");
      }
      if (audio.length === 0) {
        throw validationError("No audio was recorded.");
      }

      const transcribed = await transcription.transcribe(audio, request.mimeType, request.durationSeconds);
      if (!transcribed.ok) {
        if (
          transcribed.code === "auth_rejected" ||
          transcribed.code === "model_unavailable" ||
          transcribed.code === "provider_error"
        ) {
          throw upstreamError(transcribed.message);
        }
        throw validationError(transcribed.message);
      }

      return createFromFreeText(userId, transcribed.text, now);
    },

    async listReminders(userId: string): Promise<Reminder[]> {
      return reminders.listAll(userId);
    },

    async deleteReminder(userId: string, id: string): Promise<void> {
      const deleted = await reminders.delete(userId, id);
      if (!deleted) {
        throw notFoundError("Reminder not found.");
      }
    },
  };
}

export type RemindersService = ReturnType<typeof createRemindersService>;
