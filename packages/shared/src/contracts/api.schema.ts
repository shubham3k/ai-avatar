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
  // Measured by the recorder; only used to estimate transcription cost
  // (billed per minute). Optional so older clients still validate.
  durationSeconds: z.number().min(0).max(600).optional(),
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

// ADR-006: estimated AI usage for the current calendar month (Settings).
const providerUsageSchema = z.object({
  calls: z.number().int().min(0),
  // Null when none of the provider's calls could be priced (e.g. Groq).
  costUsd: z.number().min(0).nullable(),
});
export const llmUsageSummaryResponseSchema = z.object({
  since: z.string(),
  calls: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0),
  openai: providerUsageSchema,
  groq: providerUsageSchema,
});
export type LlmUsageSummaryResponse = z.infer<typeof llmUsageSummaryResponseSchema>;

// ADR-006 (M2): chatting with Zara.
export const sendChatMessageRequestSchema = z.object({
  // Omit to start a new conversation (titled from the first message).
  conversationId: z.string().min(1).optional(),
  text: z.string().trim().min(1).max(4000),
  // M4: the user spoke this message — Zara's reply will be read aloud.
  spoken: z.boolean().optional(),
  // M8: the user just approved this connection-tool card; its result is handed to Zara with this message.
  continueActionId: z.string().min(1).max(100).optional(),
  // M3 incognito: nothing is stored or learned; the client sends the history instead.
  incognito: z.boolean().optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .optional(),
});
export type SendChatMessageRequest = z.infer<typeof sendChatMessageRequestSchema>;

export const chatMessageDtoSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  provider: z.enum(["openai", "groq"]).nullable(),
  createdAt: z.string(),
});
export type ChatMessageDto = z.infer<typeof chatMessageDtoSchema>;

export const chatMessagesResponseSchema = z.object({ messages: z.array(chatMessageDtoSchema) });

export const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});
export const conversationsResponseSchema = z.object({ conversations: z.array(conversationSummarySchema) });

export const transcribeRequestSchema = z.object({
  audioBase64: z.string().min(1).max(10_000_000),
  mimeType: z.string().min(1),
  durationSeconds: z.number().min(0).max(600).optional(),
  // How Hindi words are written: Roman (Hinglish, default) or Devanagari.
  script: z.enum(["latin", "devanagari"]).optional(),
});
export const transcribeResponseSchema = z.object({ text: z.string() });

// ADR-006 (M3): memory, activity log, chat deletion.
export const memoryCategorySchema = z.enum(["about_you", "people", "preferences", "other"]);
export const memoryFactDtoSchema = z.object({
  id: z.string(),
  content: z.string(),
  category: memoryCategorySchema,
  updatedAt: z.string(),
});
export const memoryFactsResponseSchema = z.object({ facts: z.array(memoryFactDtoSchema) });
export const updateMemoryFactRequestSchema = z.object({ content: z.string().trim().min(1).max(300) });

export const activityEntryDtoSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  kind: z.string(),
  summary: z.string(),
  provider: z.string().nullable(),
  canUndo: z.boolean(),
  undoneAt: z.string().nullable(),
});
export const activityResponseSchema = z.object({ entries: z.array(activityEntryDtoSchema) });
export const activityQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });

export const deletedCountResponseSchema = z.object({ deleted: z.number().int().min(0) });

// ADR-006 (M4): Zara's voice. OpenAI's built-in TTS voices; marin is Zara's default.
export const OPENAI_TTS_VOICES = [
  "marin",
  "cedar",
  "coral",
  "nova",
  "shimmer",
  "sage",
  "alloy",
  "ash",
  "ballad",
  "echo",
  "fable",
  "onyx",
  "verse",
] as const;
export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];
export const DEFAULT_OPENAI_TTS_VOICE: OpenAiTtsVoice = "marin";

// One sentence or a short group of them — the desktop speaks replies in chunks.
export const speakRequestSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  voice: z.enum(OPENAI_TTS_VOICES),
});
export const speakResponseSchema = z.object({ audioBase64: z.string(), mimeType: z.literal("audio/mpeg") });

// ADR-006 (M5): proactive behaviour.
const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");
export const briefingModeSchema = z.enum(["written", "spoken", "both"]);
export type BriefingMode = z.infer<typeof briefingModeSchema>;

export const proactiveSettingsSchema = z.object({
  briefingEnabled: z.boolean(),
  briefingMode: briefingModeSchema,
  briefingWeekdaysOnly: z.boolean(),
  wrapUpEnabled: z.boolean(),
  wrapUpTime: clockTimeSchema,
  preMeetingBriefEnabled: z.boolean(),
  followUpEnabled: z.boolean(),
  followUpDays: z.number().int().min(1).max(14),
  promiseRemindersEnabled: z.boolean(),
  promiseRemindTime: clockTimeSchema,
  promiseSameDayLeadHours: z.number().int().min(1).max(12),
  holdDuringFocus: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: clockTimeSchema,
  quietHoursEnd: clockTimeSchema,
});
export type ProactiveSettingsDto = z.infer<typeof proactiveSettingsSchema>;
export const updateProactiveSettingsSchema = proactiveSettingsSchema.partial();

export const briefingKindSchema = z.enum(["morning", "wrap_up"]);
export type BriefingKind = z.infer<typeof briefingKindSchema>;
export const deliverBriefingRequestSchema = z.object({
  kind: briefingKindSchema,
  // Settings' "Show it now" button: skip the due check (still recorded as delivered).
  force: z.boolean().optional(),
});
export const deliverBriefingResponseSchema = z.union([
  z.object({ delivered: z.literal(false) }),
  z.object({
    delivered: z.literal(true),
    kind: briefingKindSchema,
    conversationId: z.string(),
    title: z.string(),
    text: z.string(),
    mode: briefingModeSchema,
  }),
]);

export const sentMailProcessResponseSchema = z.object({
  synced: z.number().int(),
  analyzed: z.number().int(),
  promiseReminders: z.number().int(),
  followUps: z.number().int(),
});

// ADR-006 (M6): recall — the local search index.
export const recallSourceTypeSchema = z.enum(["email", "event", "chat", "memory", "note", "document"]);
export const recallSettingsSchema = z.object({
  documentsFolder: z.string(),
  documentsEnabled: z.boolean(),
  peopleEnabled: z.boolean(),
  emailHistoryDays: z.number().int(),
});
export const updateRecallSettingsSchema = z.object({
  // An absolute folder path chosen with the desktop's folder picker; null = back to Documents\Zara.
  documentsFolder: z.string().min(3).max(500).nullable().optional(),
  documentsEnabled: z.boolean().optional(),
  peopleEnabled: z.boolean().optional(),
  emailHistoryDays: z.union([z.literal(30), z.literal(90)]).optional(),
});
export const recallStatusSchema = z.object({
  state: z.enum(["idle", "indexing"]),
  lastIndexedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  model: z.enum(["idle", "loading", "ready", "failed"]),
  modelError: z.string().nullable(),
  sources: z.record(z.number()),
  chunks: z.number().int(),
  embedded: z.number().int(),
  emailHistoryComplete: z.boolean(),
});
export const recallIndexResponseSchema = z.object({ started: z.boolean() });
export const recallSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(300),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
export const recallSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      sourceType: recallSourceTypeSchema,
      title: z.string(),
      snippet: z.string(),
      sourceDate: z.string().nullable(),
      url: z.string().nullable(),
    }),
  ),
});

// ADR-006 (M7): actions with approval.
export const actionDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(["email_send", "calendar_create", "calendar_update", "calendar_cancel", "mcp_call"]),
  status: z.enum(["pending", "sending", "done", "cancelled", "failed"]),
  payload: z.unknown(),
  before: z.unknown().nullable(),
  newRecipients: z.array(z.string()),
  notifies: z.array(z.string()),
  executeAt: z.string().nullable(),
  error: z.string().nullable(),
  result: z.string().nullable(),
  createdAt: z.string(),
  voiceApprovable: z.boolean(),
});
export const actionsResponseSchema = z.object({ actions: z.array(actionDtoSchema) });
export const approveActionRequestSchema = z.object({
  payload: z.unknown().optional(),
  // M8: approve a read-only connection tool and trust it from now on.
  trustTool: z.boolean().optional(),
});
export const actionSettingsSchema = z.object({
  writingStyle: z.string(),
  permissions: z.object({
    connected: z.boolean(),
    sendEmail: z.boolean(),
    editCalendar: z.boolean(),
    readDrive: z.boolean(),
  }),
});
export const updateActionSettingsSchema = z.object({ writingStyle: z.string().max(4000) });
export const executeDueResponseSchema = z.object({ executed: z.number().int() });

// ADR-006 (M8): connections (MCP servers + built-in Google Drive).
export const connectionPresetIdSchema = z.enum(["local_files", "google_drive", "web_search", "github", "notion", "slack", "browser", "custom"]);
export const connectionPresetSchema = z.object({
  id: connectionPresetIdSchema,
  name: z.string(),
  description: z.string(),
  runtime: z.enum(["bundled", "npx", "builtin", "custom"]),
  secrets: z.array(z.object({ key: z.string(), label: z.string(), help: z.string() })),
  needsFolders: z.boolean().optional(),
  note: z.string().optional(),
});
export const connectionDtoSchema = z.object({
  id: z.string(),
  preset: connectionPresetIdSchema,
  name: z.string(),
  enabled: z.boolean(),
  folders: z.array(z.string()),
  savedSecrets: z.array(z.string()),
  command: z.string().nullable(),
  args: z.array(z.string()),
  status: z.enum(["off", "starting", "ready", "error"]),
  error: z.string().nullable(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      readOnly: z.boolean(),
      destructive: z.boolean(),
      enabled: z.boolean(),
      trusted: z.boolean(),
    }),
  ),
});
export const connectionsResponseSchema = z.object({
  presets: z.array(connectionPresetSchema),
  connections: z.array(connectionDtoSchema),
});
export const addConnectionRequestSchema = z.object({
  preset: connectionPresetIdSchema,
  name: z.string().trim().max(60).optional(),
  folders: z.array(z.string().max(500)).max(20).optional(),
  secrets: z.record(z.string().max(2000)).optional(),
  command: z.string().trim().max(300).optional(),
  args: z.array(z.string().max(300)).max(30).optional(),
});
export const updateConnectionRequestSchema = z.object({
  enabled: z.boolean().optional(),
  secrets: z.record(z.string().max(2000)).optional(),
});
export const toolPolicyRequestSchema = z.object({ enabled: z.boolean().optional(), trusted: z.boolean().optional() });
export const toolPolicyParamsSchema = z.object({ id: z.string().min(1), tool: z.string().min(1).max(128) });
