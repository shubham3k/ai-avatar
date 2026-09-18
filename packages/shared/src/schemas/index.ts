import { z } from "zod";

export const prioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof prioritySchema>;

export const signalTypeSchema = z.enum([
  "reply_needed",
  "approval_needed",
  "deadline",
  "upcoming_meeting",
  "follow_up",
]);
export type SignalType = z.infer<typeof signalTypeSchema>;

export const signalStatusSchema = z.enum(["open", "resolved", "ignored"]);
export type SignalStatus = z.infer<typeof signalStatusSchema>;

export const interventionStatusSchema = z.enum([
  "pending",
  "snoozed",
  "resolved",
  "dismissed",
]);
export type InterventionStatus = z.infer<typeof interventionStatusSchema>;

export const integrationProviderSchema = z.enum(["google"]);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

export const integrationStatusSchema = z.enum([
  "connected",
  "needs_reauth",
  "error",
  "disabled",
]);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  timezone: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type User = z.infer<typeof userSchema>;

export const integrationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: integrationProviderSchema,
  status: integrationStatusSchema,
  refreshTokenEncrypted: z.string(),
  accessTokenEncrypted: z.string().nullable(),
  expiresAt: z.date().nullable(),
  scopes: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Integration = z.infer<typeof integrationSchema>;

export const emailSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerMessageId: z.string(),
  threadId: z.string(),
  fromEmail: z.string().email(),
  fromName: z.string().nullable(),
  toEmails: z.array(z.string().email()),
  subject: z.string(),
  snippet: z.string().nullable(),
  bodyText: z.string().nullable(),
  receivedAt: z.date(),
  isRead: z.boolean(),
  labels: z.array(z.string()),
  sourceUrl: z.string().nullable(),
  rawUpdatedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Email = z.infer<typeof emailSchema>;

export const calendarEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerEventId: z.string(),
  calendarId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startAt: z.date(),
  endAt: z.date(),
  isAllDay: z.boolean(),
  status: z.string().nullable(),
  organizerEmail: z.string().email().nullable(),
  organizerName: z.string().nullable(),
  attendeeEmails: z.array(z.string().email()),
  sourceUrl: z.string().nullable(),
  rawUpdatedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const signalSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: signalTypeSchema,
  sourceType: z.string(),
  sourceId: z.string(),
  title: z.string(),
  summary: z.string(),
  dueAt: z.date().nullable(),
  importanceHints: z.record(z.unknown()).nullable(),
  status: signalStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Signal = z.infer<typeof signalSchema>;

export const interventionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  signalId: z.string(),
  status: interventionStatusSchema,
  priority: prioritySchema,
  title: z.string(),
  message: z.string(),
  reason: z.string(),
  actionType: z.string(),
  actionPayload: z.record(z.unknown()).nullable(),
  snoozedUntil: z.date().nullable(),
  createdAt: z.date(),
  resolvedAt: z.date().nullable(),
  lastDeliveredAt: z.date().nullable(),
});
export type Intervention = z.infer<typeof interventionSchema>;

export const agentRunSchema = z.object({
  id: z.string(),
  userId: z.string(),
  triggerType: z.string(),
  inputSummary: z.string(),
  model: z.string(),
  outputJson: z.record(z.unknown()).nullable(),
  status: z.string(),
  errorCode: z.string().nullable(),
  durationMs: z.number().nullable(),
  createdAt: z.date(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
  service: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;