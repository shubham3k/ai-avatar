import type { PendingAction, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { conflictError, notFoundError, validationError } from "../../lib/errors.js";
import { createCalendarEventsRepository } from "../../db/repositories/calendar-events.repository.js";
import {
  createCalendarWriteService,
  type CalendarWriteService,
} from "../../providers/google/calendar/calendar-write.service.js";
import { createGmailSendService, type GmailSendService } from "../../providers/google/gmail/gmail-send.service.js";
import { createActivityService, type ActivityService } from "../activity/activity.service.js";
import { toCalendarEventInput } from "../calendar-sync.service.js";
import { createGoogleConnectionService, type GoogleConnectionService } from "../google-connection.service.js";
import {
  describeAction,
  isActionKind,
  parsePayload,
  type ActionKind,
  type ActionStatus,
  type CalendarCancelPayload,
  type CalendarCreatePayload,
  type CalendarUpdatePayload,
  type EmailPayload,
  type EventSnapshot,
  type McpCallPayload,
} from "./action-payloads.js";
import { getConnectionsService, type ConnectionsService } from "../mcp/connections.service.js";

/** ADR-006 §8: every email waits this long after Approve, with Undo. */
export const SEND_DELAY_MS = 30_000;
/** A send that should have happened this long ago didn't (the app was closed) — ask again rather than send late. */
const STALE_SEND_MS = 2 * 60_000;
/** Finished cards stay visible briefly ("Sent ✓"). */
const RECENT_MS = 15 * 60_000;

export interface ActionDto {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  payload: unknown;
  before: EventSnapshot | null;
  newRecipients: string[];
  notifies: string[];
  executeAt: string | null;
  error: string | null;
  /** M8: what an approved connection tool returned (shown on the card, handed back to Zara). */
  result: string | null;
  createdAt: string;
  /** Email: sending needs a click. Own-calendar-only changes may also be approved in chat. */
  voiceApprovable: boolean;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toActionDto(row: PendingAction): ActionDto {
  const kind = row.kind as ActionKind;
  const notifies = parseJson<string[]>(row.notifies, []);
  return {
    id: row.id,
    kind,
    status: row.status as ActionStatus,
    payload: parseJson<unknown>(row.payload, null),
    before: parseJson<EventSnapshot | null>(row.before, null),
    newRecipients: parseJson<string[]>(row.newRecipients, []),
    notifies,
    executeAt: row.executeAt?.toISOString() ?? null,
    error: row.error,
    result: row.result,
    createdAt: row.createdAt.toISOString(),
    voiceApprovable: kind !== "email_send" && kind !== "mcp_call" && notifies.length === 0,
  };
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (/access was denied|Reconnect your Google/i.test(message)) {
    return "Zara doesn't have permission for this yet — reconnect Google in Settings → Actions.";
  }
  if (/not connected|No Google/i.test(message)) return "Google isn't connected.";
  return message || "It didn't go through. Try again.";
}

/**
 * ADR-006 §8 — the approval layer. The model can only *propose*; nothing
 * leaves the PC until the user approves the card (email: always a click,
 * then 30 s with Undo; own-calendar-only changes may also be approved in
 * chat). Payloads are re-validated at every step, and every approve,
 * cancel, and result is logged.
 */
export function createActionsService(dependencies?: {
  prisma?: PrismaClient;
  connection?: GoogleConnectionService;
  gmail?: GmailSendService;
  calendar?: CalendarWriteService;
  activity?: ActivityService;
  schedule?: (run: () => void, ms: number) => void;
  mcp?: ConnectionsService;
}) {
  const prisma = dependencies?.prisma ?? defaultPrisma;
  const connection = dependencies?.connection ?? createGoogleConnectionService();
  const gmail = dependencies?.gmail ?? createGmailSendService();
  const calendar = dependencies?.calendar ?? createCalendarWriteService();
  const activity = dependencies?.activity ?? createActivityService({ prisma });
  const events = createCalendarEventsRepository(prisma);
  const mcp = () => dependencies?.mcp ?? getConnectionsService();
  const schedule =
    dependencies?.schedule ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      timer.unref?.();
    });

  async function selfEmail(userId: string): Promise<string | null> {
    const integration = await prisma.integration.findFirst({ where: { userId, provider: "google" }, select: { providerAccountEmail: true } });
    return integration?.providerAccountEmail?.toLowerCase() ?? null;
  }

  /** Addresses the user has never emailed or heard from — flagged on the card. */
  async function newRecipients(userId: string, addresses: string[]): Promise<string[]> {
    const unknown: string[] = [];
    for (const address of addresses) {
      const seen = await prisma.email.findFirst({
        where: { userId, OR: [{ fromEmail: address }, { toEmails: { contains: `"${address}"` } }] },
        select: { id: true },
      });
      if (!seen) unknown.push(address);
    }
    return unknown;
  }

  async function eventSnapshot(userId: string, eventId: string): Promise<{ row: NonNullable<Awaited<ReturnType<typeof prisma.calendarEvent.findFirst>>>; snapshot: EventSnapshot }> {
    const row = await prisma.calendarEvent.findFirst({ where: { id: eventId, userId } });
    if (!row) throw notFoundError("That event isn't in your calendar any more.");
    let attendees: string[] = [];
    try {
      attendees = JSON.parse(row.attendeeEmails) as string[];
    } catch {
      attendees = [];
    }
    return {
      row,
      snapshot: {
        title: row.title,
        start: row.startAt.toISOString(),
        end: row.endAt.toISOString(),
        location: row.location,
        description: row.description,
        attendees,
      },
    };
  }

  async function record(userId: string, row: PendingAction, summary: string) {
    await activity.record(userId, { kind: "action_cancelled", summary: `${summary} ${describeAction(row.kind as ActionKind, JSON.parse(row.payload))}` });
  }

  async function execute(row: PendingAction): Promise<PendingAction> {
    const kind = row.kind as ActionKind;
    const parsed = parsePayload(kind, JSON.parse(row.payload));
    if (!parsed.ok) {
      return prisma.pendingAction.update({ where: { id: row.id }, data: { status: "failed", error: parsed.message } });
    }
    if (kind === "mcp_call") {
      const call = parsed.value as McpCallPayload;
      try {
        const output = await mcp().call(row.userId, call.connectionId, call.tool, call.args);
        await activity.record(row.userId, { kind: "mcp_call", summary: `Used ${call.connectionName} · ${call.tool} (you approved it)` });
        return prisma.pendingAction.update({ where: { id: row.id }, data: { status: "done", executedAt: new Date(), result: output, error: null } });
      } catch (err) {
        return prisma.pendingAction.update({ where: { id: row.id }, data: { status: "failed", error: friendlyError(err) } });
      }
    }
    try {
      const refreshToken = await connection.getDecryptedRefreshToken(row.userId);
      const self = await selfEmail(row.userId);
      let resultId = "";
      if (kind === "email_send") {
        const email = parsed.value as EmailPayload;
        const reply = email.replyTo ? await gmail.replyHeaders(refreshToken, email.replyTo.providerMessageId).catch(() => null) : null;
        const sent = await gmail.send(refreshToken, {
          to: email.to,
          cc: email.cc,
          subject: email.subject,
          body: email.body,
          inReplyTo: reply?.messageId ?? null,
          references: reply?.references ?? null,
          threadId: email.replyTo?.threadId ?? null,
        });
        resultId = sent.id;
        const edited = row.original !== null && row.original !== row.payload;
        await activity.record(row.userId, {
          kind: "email_sent",
          summary: `Sent ${describeAction(kind, email)}${edited ? " (you edited Zara's draft)" : ""}`,
        });
      } else if (kind === "calendar_create") {
        const create = parsed.value as CalendarCreatePayload;
        const created = await calendar.create(refreshToken, {
          title: create.title,
          start: new Date(create.start),
          end: new Date(create.end),
          attendees: create.attendees.filter((address) => address !== self),
          location: create.location,
          description: create.description,
        });
        resultId = created.id;
        const input = toCalendarEventInput(row.userId, created, new Date());
        if (input) await events.upsertEvent(input);
        await activity.record(row.userId, {
          kind: "calendar_created",
          summary: `Added "${create.title}" to your calendar`,
          undo: { calendarId: created.calendarId, providerEventId: created.id },
        });
      } else if (kind === "calendar_update") {
        const update = parsed.value as CalendarUpdatePayload;
        const before = JSON.parse(row.before ?? "null") as EventSnapshot | null;
        const notifies = JSON.parse(row.notifies) as string[];
        const updated = await calendar.update(
          refreshToken,
          update.calendarId,
          update.providerEventId,
          {
            ...(update.title !== undefined ? { title: update.title } : {}),
            ...(update.start ? { start: new Date(update.start) } : {}),
            ...(update.end ? { end: new Date(update.end) } : {}),
            ...(update.location !== undefined ? { location: update.location } : {}),
          },
          notifies.length > 0,
        );
        resultId = updated.id;
        const input = toCalendarEventInput(row.userId, updated, new Date());
        if (input) await events.upsertEvent(input);
        await activity.record(row.userId, {
          kind: "calendar_updated",
          summary: `Changed "${before?.title ?? updated.summary ?? "an event"}" in your calendar`,
          undo: before
            ? {
                calendarId: update.calendarId,
                providerEventId: update.providerEventId,
                title: before.title,
                start: before.start,
                end: before.end,
                location: before.location,
                notify: notifies.length > 0,
              }
            : null,
        });
      } else {
        const cancel = parsed.value as CalendarCancelPayload;
        const before = JSON.parse(row.before ?? "null") as EventSnapshot | null;
        const notifies = JSON.parse(row.notifies) as string[];
        await calendar.cancel(refreshToken, cancel.calendarId, cancel.providerEventId, notifies.length > 0);
        await prisma.calendarEvent.deleteMany({ where: { id: cancel.eventId, userId: row.userId } });
        resultId = cancel.providerEventId;
        await activity.record(row.userId, {
          kind: "calendar_cancelled",
          summary: `Cancelled "${cancel.title}"${notifies.length ? " (attendees were told)" : ""}`,
          undo: before ? { ...before, attendees: before.attendees.filter((address) => address !== self) } : null,
        });
      }
      return prisma.pendingAction.update({
        where: { id: row.id },
        data: { status: "done", executedAt: new Date(), resultId, error: null },
      });
    } catch (err) {
      return prisma.pendingAction.update({ where: { id: row.id }, data: { status: "failed", error: friendlyError(err) } });
    }
  }

  async function executeDue(now: Date = new Date()): Promise<number> {
    const due = await prisma.pendingAction.findMany({ where: { status: "sending", executeAt: { lte: now } } });
    let count = 0;
    for (const row of due) {
      // Claim it: only one caller (timer or backup tick) may send.
      const claimed = await prisma.pendingAction.updateMany({ where: { id: row.id, status: "sending" }, data: { status: "done" } });
      if (claimed.count === 0) continue;
      if (row.executeAt && now.getTime() - row.executeAt.getTime() > STALE_SEND_MS) {
        await prisma.pendingAction.update({
          where: { id: row.id },
          data: { status: "pending", executeAt: null, error: "Not sent — Zara was closed before sending. Approve again to send." },
        });
        continue;
      }
      await execute({ ...row, status: "sending" });
      count += 1;
    }
    return count;
  }

  async function find(userId: string, id: string): Promise<PendingAction> {
    const row = await prisma.pendingAction.findFirst({ where: { id, userId } });
    if (!row) throw notFoundError("That action isn't there any more.");
    return row;
  }

  return {
    executeDue,

    /** Called only by Zara's tools — creates a card; nothing is sent. */
    async propose(userId: string, kind: ActionKind, rawPayload: unknown, options: { conversationId?: string | null } = {}): Promise<ActionDto> {
      const parsed = parsePayload(kind, rawPayload);
      if (!parsed.ok) throw validationError(parsed.message);
      const self = await selfEmail(userId);
      let notifies: string[] = [];
      let before: EventSnapshot | null = null;
      let recipients: string[] = [];
      if (kind === "email_send") {
        const email = parsed.value as EmailPayload;
        notifies = [...email.to, ...email.cc];
        recipients = await newRecipients(userId, notifies);
      } else if (kind === "calendar_create") {
        notifies = (parsed.value as CalendarCreatePayload).attendees.filter((address) => address !== self);
        recipients = await newRecipients(userId, notifies);
      } else if (kind === "mcp_call") {
        notifies = [];
      } else {
        const target = await eventSnapshot(userId, (parsed.value as CalendarUpdatePayload | CalendarCancelPayload).eventId);
        before = target.snapshot;
        notifies = target.snapshot.attendees.map((address) => address.toLowerCase()).filter((address) => address !== self);
      }
      const payload = JSON.stringify(parsed.value);
      const row = await prisma.pendingAction.create({
        data: {
          userId,
          kind,
          payload,
          original: payload,
          before: before ? JSON.stringify(before) : null,
          newRecipients: JSON.stringify(recipients),
          notifies: JSON.stringify(notifies),
          conversationId: options.conversationId ?? null,
        },
      });
      return toActionDto(row);
    },

    /** Open and recently finished cards, newest first. Also recovers sends interrupted by a restart. */
    async list(userId: string, now: Date = new Date()): Promise<ActionDto[]> {
      await executeDue(now);
      const rows = await prisma.pendingAction.findMany({
        where: {
          userId,
          OR: [{ status: { in: ["pending", "sending"] } }, { updatedAt: { gte: new Date(now.getTime() - RECENT_MS) } }],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return rows.map(toActionDto);
    },

    async get(userId: string, id: string): Promise<ActionDto> {
      return toActionDto(await find(userId, id));
    },

    /**
     * Approve. `payload` carries the user's edits (validated again). Email
     * starts the 30 s undo window; calendar changes run now. `via: "chat"`
     * (Zara approving on the user's spoken/typed "yes") is refused for email
     * and for anything that notifies other people.
     */
    async approve(
      userId: string,
      id: string,
      options: { payload?: unknown; via: "click" | "chat"; trustTool?: boolean },
      now: Date = new Date(),
    ): Promise<ActionDto> {
      const row = await find(userId, id);
      if (row.status !== "pending") throw conflictError("That card was already handled.");
      const kind = row.kind as ActionKind;
      const dto = toActionDto(row);
      if (options.via === "chat" && !dto.voiceApprovable) {
        throw conflictError(kind === "email_send" ? "Emails are only sent after you click Approve on the card." : "This change notifies other people — please approve it on the card.");
      }
      let payload = row.payload;
      if (kind === "mcp_call" && options.payload !== undefined) throw validationError("Connection tool calls can't be edited — cancel and ask Zara again.");
      if (kind === "mcp_call" && options.trustTool) {
        const call = JSON.parse(row.payload) as McpCallPayload;
        if (!call.readOnly) throw validationError("Only tools that just read can run without asking.");
        await mcp().setToolPolicy(userId, call.connectionId, call.tool, { trusted: true });
      }
      if (options.payload !== undefined) {
        const parsed = parsePayload(kind, options.payload);
        if (!parsed.ok) throw validationError(parsed.message);
        payload = JSON.stringify(parsed.value);
        if (kind === "email_send") {
          const before = (JSON.parse(row.original ?? row.payload) as EmailPayload).body;
          const after = (parsed.value as EmailPayload).body;
          if (before !== after) await prisma.draftEdit.create({ data: { userId, before: before.slice(0, 2000), after: after.slice(0, 2000) } });
          const email = parsed.value as EmailPayload;
          await prisma.pendingAction.update({
            where: { id },
            data: { newRecipients: JSON.stringify(await newRecipients(userId, [...email.to, ...email.cc])), notifies: JSON.stringify([...email.to, ...email.cc]) },
          });
        }
      }
      if (kind === "email_send") {
        const executeAt = new Date(now.getTime() + SEND_DELAY_MS);
        const updated = await prisma.pendingAction.update({ where: { id }, data: { payload, status: "sending", executeAt, error: null } });
        schedule(() => void executeDue(), SEND_DELAY_MS + 250);
        return toActionDto(updated);
      }
      // Calendar changes and connection tools run straight away; execute() records done/failed.
      const updated = await prisma.pendingAction.update({ where: { id }, data: { payload, status: "done", executeAt: now } });
      return toActionDto(await execute(updated));
    },

    /** Cancel a card, or Undo during the 30 s send window. */
    async cancel(userId: string, id: string): Promise<ActionDto> {
      const row = await find(userId, id);
      const cancelled = await prisma.pendingAction.updateMany({
        where: { id, status: { in: ["pending", "sending", "failed"] } },
        data: { status: "cancelled", executeAt: null },
      });
      if (cancelled.count === 0) throw conflictError(row.status === "done" ? "Too late — it already went out." : "That card was already handled.");
      await record(userId, row, row.status === "sending" ? "Stopped sending" : "You cancelled");
      return toActionDto(await find(userId, id));
    },
  };
}

export type ActionsService = ReturnType<typeof createActionsService>;

let shared: ActionsService | null = null;
/** One per process, so the send timer and the backup tick share state. */
export function getActionsService(): ActionsService {
  shared ??= createActionsService();
  return shared;
}

export { isActionKind };
