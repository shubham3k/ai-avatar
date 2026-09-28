import { z } from "zod";
import {
  interventionStatusSchema,
  prioritySchema,
} from "../schemas/index.js";

export const isoDateTimeSchema = z.string().datetime();

export const interventionActionSchema = z.enum(["DONE", "REMIND_LATER"]);

export const interventionDtoSchema = z.object({
  id: z.string(),
  signalId: z.string(),
  status: interventionStatusSchema,
  priority: prioritySchema,
  title: z.string(),
  message: z.string(),
  reason: z.string(),
  actionType: z.string(),
  actionPayload: z.record(z.unknown()).nullable(),
  snoozedUntil: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
  lastDeliveredAt: isoDateTimeSchema.nullable(),
});
export type InterventionDto = z.infer<typeof interventionDtoSchema>;

export const inboxResponseSchema = z.object({
  items: z.array(interventionDtoSchema),
});
export type InboxResponse = z.infer<typeof inboxResponseSchema>;

export const idParamsSchema = z.object({
  id: z.string().min(1),
});

export const snoozeRequestSchema = z.object({
  minutes: z.number().int().min(1).max(60 * 24 * 7),
});
export type SnoozeRequest = z.infer<typeof snoozeRequestSchema>;

export const doneRequestSchema = z.object({}).strict();

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const googleConnectionStatusSchema = z.object({
  connected: z.boolean(),
  provider: z.literal("google"),
  email: z.string().nullable(),
  scopes: z.array(z.string()),
});
export type GoogleConnectionStatus = z.infer<typeof googleConnectionStatusSchema>;

export const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  subject: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  date: z.string().nullable(),
  snippet: z.string().nullable(),
  labels: z.array(z.string()),
});
export type GmailMessage = z.infer<typeof gmailMessageSchema>;

export const gmailMessagesResponseSchema = z.object({
  messages: z.array(gmailMessageSchema),
});
export type GmailMessagesResponse = z.infer<typeof gmailMessagesResponseSchema>;

// max mirrors GMAIL_MAX_MESSAGE_LIMIT in apps/api/src/providers/google/gmail/gmail.types.ts
export const gmailMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export const gmailSyncResponseSchema = z.object({
  fetched: z.number().int().min(0),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
});
export type GmailSyncResponse = z.infer<typeof gmailSyncResponseSchema>;

export const gmailSignalDetectionResponseSchema = z.object({
  analyzed: z.number().int().min(0),
  actionable: z.number().int().min(0),
  signalsCreated: z.number().int().min(0),
  interventionsCreated: z.number().int().min(0),
});
export type GmailSignalDetectionResponse = z.infer<
  typeof gmailSignalDetectionResponseSchema
>;

// max mirrors SIGNAL_DETECTION_MAX_LIMIT in apps/api/src/domain/gmail-signal-detection.service.ts
export const gmailSignalDetectionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export const storedEmailDtoSchema = z.object({
  id: z.string(),
  providerMessageId: z.string(),
  threadId: z.string(),
  fromEmail: z.string(),
  fromName: z.string().nullable(),
  toEmails: z.array(z.string()),
  subject: z.string(),
  snippet: z.string().nullable(),
  receivedAt: isoDateTimeSchema,
  isRead: z.boolean(),
  labels: z.array(z.string()),
  sourceUrl: z.string().nullable(),
});
export type StoredEmailDto = z.infer<typeof storedEmailDtoSchema>;

export const storedEmailsResponseSchema = z.object({
  messages: z.array(storedEmailDtoSchema),
});
export type StoredEmailsResponse = z.infer<typeof storedEmailsResponseSchema>;

// A local read of our own DB, not a Gmail API call — a slightly higher cap is fine.
export const storedEmailsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const calendarAttendeeSchema = z.object({
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  responseStatus: z.string().nullable(),
});

export const calendarOrganizerSchema = z.object({
  email: z.string().nullable(),
  displayName: z.string().nullable(),
});

export const calendarEventDtoSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  // ISO datetime for a timed event, or "YYYY-MM-DD" for an all-day event —
  // not always a full datetime, so this is a plain string, not isoDateTimeSchema.
  start: z.string().nullable(),
  end: z.string().nullable(),
  isAllDay: z.boolean(),
  attendees: z.array(calendarAttendeeSchema),
  organizer: calendarOrganizerSchema.nullable(),
  status: z.string().nullable(),
  htmlLink: z.string().nullable(),
});
export type CalendarEventDto = z.infer<typeof calendarEventDtoSchema>;

export const calendarEventsResponseSchema = z.object({
  events: z.array(calendarEventDtoSchema),
});
export type CalendarEventsResponse = z.infer<typeof calendarEventsResponseSchema>;

// max mirrors CALENDAR_MAX_EVENT_LIMIT in apps/api/src/providers/google/calendar/calendar.types.ts
export const calendarEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export const calendarSyncResponseSchema = z.object({
  fetched: z.number().int().min(0),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
});
export type CalendarSyncResponse = z.infer<typeof calendarSyncResponseSchema>;

// A local read of our own DB, not a Calendar API call — mirrors calendarEventDtoSchema,
// since the stored representation carries the same normalized fields.
export const storedCalendarEventsResponseSchema = z.object({
  events: z.array(calendarEventDtoSchema),
});
export type StoredCalendarEventsResponse = z.infer<
  typeof storedCalendarEventsResponseSchema
>;

export const storedCalendarEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const calendarSignalDetectionResponseSchema = z.object({
  analyzed: z.number().int().min(0),
  actionable: z.number().int().min(0),
  signalsCreated: z.number().int().min(0),
  interventionsCreated: z.number().int().min(0),
});
export type CalendarSignalDetectionResponse = z.infer<
  typeof calendarSignalDetectionResponseSchema
>;

// max mirrors CALENDAR_SIGNAL_DETECTION_MAX_LIMIT in apps/api/src/domain/calendar-signal-detection.service.ts
export const calendarSignalDetectionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export const crossSourceRelationshipTypeSchema = z.enum([
  "attendee_match",
  "topic_overlap",
]);

export const crossSourceRelationshipStrengthSchema = z.enum(["strong", "possible"]);

export const crossSourceRelationshipSchema = z.object({
  type: crossSourceRelationshipTypeSchema,
  strength: crossSourceRelationshipStrengthSchema,
  reason: z.string(),
  matchedTerms: z.array(z.string()).optional(),
});

export const crossSourceTemporalContextSchema = z.object({
  emailReceivedAt: isoDateTimeSchema,
  eventStartAt: isoDateTimeSchema,
  hoursBetween: z.number(),
});

export const crossSourceContextDtoSchema = z.object({
  emailId: z.string(),
  calendarEventId: z.string(),
  relationship: crossSourceRelationshipSchema,
  temporalContext: crossSourceTemporalContextSchema,
});
export type CrossSourceContextDto = z.infer<typeof crossSourceContextDtoSchema>;

export const crossSourceContextResponseSchema = z.object({
  contexts: z.array(crossSourceContextDtoSchema),
});
export type CrossSourceContextResponse = z.infer<
  typeof crossSourceContextResponseSchema
>;

export const consolidatedSituationDtoSchema = z.object({
  id: z.string(),
  signalIds: z.array(z.string()),
  primarySignalId: z.string(),
  emailIds: z.array(z.string()),
  calendarEventIds: z.array(z.string()),
  relationship: z.object({
    type: crossSourceRelationshipTypeSchema,
    strength: crossSourceRelationshipStrengthSchema,
  }),
});
export type ConsolidatedSituationDto = z.infer<typeof consolidatedSituationDtoSchema>;

export const consolidatedSituationsResponseSchema = z.object({
  situations: z.array(consolidatedSituationDtoSchema),
});
export type ConsolidatedSituationsResponse = z.infer<
  typeof consolidatedSituationsResponseSchema
>;

export const priorityLevelSchema = z.enum(["high", "medium", "low"]);

export const prioritizedSituationDtoSchema = z.object({
  situationId: z.string(),
  priority: priorityLevelSchema,
  reason: z.string(),
  recommendedAction: z.string(),
});
export type PrioritizedSituationDto = z.infer<typeof prioritizedSituationDtoSchema>;

export const prioritizationResponseSchema = z.object({
  prioritizedSituations: z.array(prioritizedSituationDtoSchema),
});
export type PrioritizationResponse = z.infer<typeof prioritizationResponseSchema>;

export const interventionOutcomeSchema = z.enum(["created", "reused", "skipped"]);

export const assistantEvaluationResultDtoSchema = z.object({
  situationId: z.string(),
  eligible: z.boolean(),
  priority: priorityLevelSchema.nullable(),
  interventionId: z.string().nullable(),
  outcome: interventionOutcomeSchema,
  message: z.string().nullable(),
});
export type AssistantEvaluationResultDto = z.infer<
  typeof assistantEvaluationResultDtoSchema
>;

export const assistantEvaluationResponseSchema = z.object({
  results: z.array(assistantEvaluationResultDtoSchema),
});
export type AssistantEvaluationResponse = z.infer<
  typeof assistantEvaluationResponseSchema
>;

export const dailyEventSummaryDtoSchema = z.object({
  id: z.string(),
  summary: z.string().nullable(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  attendeeEmails: z.array(z.string()),
});
export type DailyEventSummaryDto = z.infer<typeof dailyEventSummaryDtoSchema>;

export const dailyEmailSummaryDtoSchema = z.object({
  id: z.string(),
  fromEmail: z.string(),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  receivedAt: isoDateTimeSchema,
});
export type DailyEmailSummaryDto = z.infer<typeof dailyEmailSummaryDtoSchema>;

export const dailySignalSummaryDtoSchema = z.object({
  id: z.string(),
  sourceType: z.string(),
  title: z.string(),
  confidence: z.enum(["high", "medium"]).nullable(),
  dueAt: isoDateTimeSchema.nullable(),
});
export type DailySignalSummaryDto = z.infer<typeof dailySignalSummaryDtoSchema>;

export const dailyGoalSummaryDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
});
export type DailyGoalSummaryDto = z.infer<typeof dailyGoalSummaryDtoSchema>;

export const dailyContextResponseSchema = z.object({
  currentTime: isoDateTimeSchema,
  upcomingEvents: z.array(dailyEventSummaryDtoSchema),
  relevantEmails: z.array(dailyEmailSummaryDtoSchema),
  activeSignals: z.array(dailySignalSummaryDtoSchema),
  consolidatedSituations: z.array(consolidatedSituationDtoSchema),
  goals: z.array(dailyGoalSummaryDtoSchema),
});
export type DailyContextResponse = z.infer<typeof dailyContextResponseSchema>;

// --- Phase 3.4 — Goals & Commitments -------------------------------------

export const goalDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type GoalDto = z.infer<typeof goalDtoSchema>;

export const goalsResponseSchema = z.object({
  goals: z.array(goalDtoSchema),
});
export type GoalsResponse = z.infer<typeof goalsResponseSchema>;

export const goalsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional(),
});

export const createGoalRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
});
export type CreateGoalRequest = z.infer<typeof createGoalRequestSchema>;

export const updateGoalRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateGoalRequest = z.infer<typeof updateGoalRequestSchema>;

// --- Reminders --------------------------------------------------------

export const reminderDtoSchema = z.object({
  id: z.string(),
  text: z.string(),
  dueAt: isoDateTimeSchema,
  // null means "fires exactly at dueAt" (the exact-time-picker path) —
  // set when parsed from free text, to some time before dueAt.
  remindAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ReminderDto = z.infer<typeof reminderDtoSchema>;

export const remindersResponseSchema = z.object({
  reminders: z.array(reminderDtoSchema),
});
export type RemindersResponse = z.infer<typeof remindersResponseSchema>;

export const createReminderRequestSchema = z.object({
  text: z.string().min(1).max(500),
  dueAt: isoDateTimeSchema,
});
export type CreateReminderRequest = z.infer<typeof createReminderRequestSchema>;

export const createReminderFromTextRequestSchema = z.object({
  text: z.string().min(1).max(500),
});
export type CreateReminderFromTextRequest = z.infer<typeof createReminderFromTextRequestSchema>;

export const createReminderFromVoiceRequestSchema = z.object({
  // Base64-encoded audio, no data: URI prefix. ~7MB cap keeps a very long
  // recording from ballooning the request — a normal spoken reminder is a
  // few hundred KB at most.
  audioBase64: z.string().min(1).max(10_000_000),
  mimeType: z.string().min(1),
});
export type CreateReminderFromVoiceRequest = z.infer<
  typeof createReminderFromVoiceRequestSchema
>;

export const reminderDetectionResponseSchema = z.object({
  analyzed: z.number().int().min(0),
  interventionsCreated: z.number().int().min(0),
});
export type ReminderDetectionResponse = z.infer<typeof reminderDetectionResponseSchema>;

// max mirrors REMINDER_DETECTION_MAX_LIMIT in apps/api/src/domain/reminder-detection.service.ts
export const reminderDetectionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export const deleteReminderResponseSchema = z.object({
  deleted: z.literal(true),
});
export type DeleteReminderResponse = z.infer<typeof deleteReminderResponseSchema>;
