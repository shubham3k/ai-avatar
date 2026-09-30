import { z } from "zod";

/**
 * ADR-006 M7: what each kind of external action carries. Validated when
 * Zara proposes it, again when the user edits it, and again right before
 * it's executed — the payload is the single source of truth for what
 * leaves the PC.
 */
export type ActionKind = "email_send" | "calendar_create" | "calendar_update" | "calendar_cancel" | "mcp_call";
export type ActionStatus = "pending" | "sending" | "done" | "cancelled" | "failed";

const address = z.string().trim().toLowerCase().email().max(254);
const isoDate = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), "Not a valid date/time");

export const emailPayloadSchema = z.object({
  to: z.array(address).min(1).max(20),
  cc: z.array(address).max(20).default([]),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
  /** Set for replies: the local email being answered. */
  replyTo: z
    .object({ emailId: z.string(), providerMessageId: z.string(), threadId: z.string() })
    .nullable()
    .default(null),
});

export const calendarCreatePayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    start: isoDate,
    end: isoDate,
    attendees: z.array(address).max(50).default([]),
    location: z.string().trim().max(300).nullable().default(null),
    description: z.string().trim().max(5000).nullable().default(null),
  })
  .refine((value) => new Date(value.end) > new Date(value.start), "The end must be after the start.");

export const calendarUpdatePayloadSchema = z
  .object({
    eventId: z.string(),
    providerEventId: z.string(),
    calendarId: z.string(),
    title: z.string().trim().min(1).max(200).optional(),
    start: isoDate.optional(),
    end: isoDate.optional(),
    location: z.string().trim().max(300).nullable().optional(),
  })
  .refine((value) => value.title !== undefined || value.start !== undefined || value.end !== undefined || value.location !== undefined, "Nothing to change.")
  .refine((value) => !(value.start && value.end) || new Date(value.end) > new Date(value.start), "The end must be after the start.");

export const calendarCancelPayloadSchema = z.object({
  eventId: z.string(),
  providerEventId: z.string(),
  calendarId: z.string(),
  title: z.string(),
});

/** M8: a connection tool Zara wants to use (strict trust: asks unless the user trusted this read-only tool). */
export const mcpCallPayloadSchema = z.object({
  connectionId: z.string(),
  connectionName: z.string(),
  tool: z.string().max(128),
  args: z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 20_000, "Too much input for one tool call."),
  readOnly: z.boolean(),
  destructive: z.boolean(),
});

export const PAYLOAD_SCHEMAS = {
  email_send: emailPayloadSchema,
  calendar_create: calendarCreatePayloadSchema,
  calendar_update: calendarUpdatePayloadSchema,
  calendar_cancel: calendarCancelPayloadSchema,
  mcp_call: mcpCallPayloadSchema,
} as const;

export type EmailPayload = z.infer<typeof emailPayloadSchema>;
export type CalendarCreatePayload = z.infer<typeof calendarCreatePayloadSchema>;
export type CalendarUpdatePayload = z.infer<typeof calendarUpdatePayloadSchema>;
export type CalendarCancelPayload = z.infer<typeof calendarCancelPayloadSchema>;
export type McpCallPayload = z.infer<typeof mcpCallPayloadSchema>;

/** The event as it was before an update/cancel — shown as "before → after" and used by Undo. */
export interface EventSnapshot {
  title: string;
  start: string;
  end: string;
  location: string | null;
  description: string | null;
  attendees: string[];
}

export function isActionKind(value: string): value is ActionKind {
  return value in PAYLOAD_SCHEMAS;
}

export function parsePayload(kind: ActionKind, raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const result = PAYLOAD_SCHEMAS[kind].safeParse(raw);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, message: result.error.issues.map((issue) => issue.message).join("; ") };
}

/** One line for the activity log. */
export function describeAction(kind: ActionKind, payload: unknown): string {
  switch (kind) {
    case "email_send": {
      const email = payload as EmailPayload;
      return `email "${email.subject}" to ${email.to.join(", ")}`;
    }
    case "calendar_create":
      return `new event "${(payload as CalendarCreatePayload).title}"`;
    case "calendar_update":
      return `change to an event${(payload as CalendarUpdatePayload).title ? ` ("${(payload as CalendarUpdatePayload).title}")` : ""}`;
    case "calendar_cancel":
      return `cancelling "${(payload as CalendarCancelPayload).title}"`;
    case "mcp_call":
      return `${(payload as McpCallPayload).connectionName} · ${(payload as McpCallPayload).tool}`;
  }
}
