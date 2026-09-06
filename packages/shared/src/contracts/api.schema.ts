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
