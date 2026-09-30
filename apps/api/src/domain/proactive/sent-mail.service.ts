import type { Email, PrismaClient } from "@prisma/client";
import { decodeStringArray } from "../../lib/json-array.js";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { createEmailsRepository } from "../../db/repositories/emails.repository.js";
import {
  createInterventionsRepository,
  createSignalsRepository,
} from "../../db/repositories/interventions.repository.js";
import { createGmailSentService, type GmailSentService } from "../../providers/google/gmail/gmail-sent.service.js";
import type { LlmProvider } from "../../providers/llm/llm-provider.js";
import { createActivityService, type ActivityService } from "../activity/activity.service.js";
import { createGoogleConnectionService, type GoogleConnectionService } from "../google-connection.service.js";
import { toEmailInput } from "../gmail-sync.service.js";
import { createDefaultLlmProvider } from "../llm-usage.service.js";
import {
  daysAgoLabel,
  decideFollowUp,
  FOLLOW_UP_MAX_AGE_DAYS,
  FOLLOW_UP_RECHECK_HOURS,
  recipientsLabel,
} from "./follow-up.rules.js";
import { clockLabel, shortDayLabel } from "./local-time.js";
import { createProactiveSettingsService, type ProactiveSettingsService } from "./proactive-settings.service.js";
import { computePromiseReminder } from "./promise-timing.js";
import {
  buildSentMailInput,
  buildSentMailJsonSchema,
  resolvePromiseDate,
  SENT_MAIL_INSTRUCTIONS,
  sentMailAnalysisSchema,
} from "./sent-mail-analysis.js";

const DAY_MS = 24 * 60 * 60_000;
/** Per run: keeps each sync quick and bounds cost. */
const SYNC_LIMIT = 25;
const ANALYZE_LIMIT = 10;
const FOLLOW_UP_CHECK_LIMIT = 5;
/** Labels are stored as a JSON array string; this narrows queries to sent mail in SQL. */
const SENT_LABEL_JSON = '"SENT"';

export interface SentMailProcessResult {
  synced: number;
  analyzed: number;
  promiseReminders: number;
  followUps: number;
}

function isSent(email: Pick<Email, "labels">): boolean {
  return decodeStringArray(email.labels).includes("SENT");
}

/**
 * ADR-006 M5 — the user's sent mail:
 * 1. sync the last 14 days of sent mail (own text only, trimmed, stored locally);
 * 2. analyse each new one once (AI, redacted): expects a reply? promises?
 * 3. turn promises into reminders (day before 10:00 / 2 h before), logged with undo;
 * 4. nudge about emails still unanswered after N days (checked against the Gmail thread).
 * Everything is skipped when both follow-ups and promise reminders are off.
 */
export function createSentMailService(dependencies?: {
  prisma?: PrismaClient;
  connection?: GoogleConnectionService;
  gmail?: GmailSentService;
  provider?: LlmProvider;
  settings?: ProactiveSettingsService;
  activity?: ActivityService;
}) {
  const prisma = dependencies?.prisma ?? defaultPrisma;
  const connection = dependencies?.connection ?? createGoogleConnectionService();
  const gmail = dependencies?.gmail ?? createGmailSentService();
  const settingsService = dependencies?.settings ?? createProactiveSettingsService({ prisma });
  const activity = dependencies?.activity ?? createActivityService({ prisma });
  const emails = createEmailsRepository(prisma);
  const signals = createSignalsRepository(prisma);
  const interventions = createInterventionsRepository(prisma);
  let provider = dependencies?.provider ?? null;

  /** Names people use in their own emails — nicer than raw addresses. */
  async function knownNames(userId: string, addresses: string[]): Promise<Map<string, string>> {
    const rows = await prisma.email.findMany({
      where: { userId, fromEmail: { in: addresses }, fromName: { not: null } },
      select: { fromEmail: true, fromName: true },
      take: 50,
    });
    return new Map(rows.map((row) => [row.fromEmail.toLowerCase(), row.fromName!]));
  }

  async function syncSent(userId: string, refreshToken: string, now: Date): Promise<number> {
    const messages = await gmail.listSentMessages(refreshToken, { newerThanDays: FOLLOW_UP_MAX_AGE_DAYS, limit: SYNC_LIMIT });
    for (const message of messages) {
      await emails.upsertEmail({ ...toEmailInput(userId, message, now), bodyText: message.bodyText });
    }
    return messages.length;
  }

  async function analyze(userId: string, now: Date, createReminders: boolean): Promise<{ analyzed: number; reminders: number }> {
    const settings = await settingsService.get(userId);
    const pending = (
      await prisma.email.findMany({
        where: {
          userId,
          labels: { contains: SENT_LABEL_JSON },
          sentAnalyzedAt: null,
          receivedAt: { gte: new Date(now.getTime() - FOLLOW_UP_MAX_AGE_DAYS * DAY_MS) },
        },
        orderBy: { receivedAt: "desc" },
        take: ANALYZE_LIMIT * 2,
      })
    )
      .filter(isSent)
      .slice(0, ANALYZE_LIMIT);

    let analyzed = 0;
    let reminders = 0;
    for (const email of pending) {
      const recipients = decodeStringArray(email.toEmails);
      const body = email.bodyText ?? email.snippet ?? "";
      let analysis;
      try {
        provider ??= createDefaultLlmProvider();
        const raw = await provider.createStructuredCompletion({
          instructions: SENT_MAIL_INSTRUCTIONS,
          input: buildSentMailInput({ sentAt: email.receivedAt, recipients: recipients.join(", "), subject: email.subject, body }),
          schemaName: "sent_mail_analysis",
          jsonSchema: buildSentMailJsonSchema(),
          maxOutputTokens: 400,
          operation: "other",
        });
        analysis = sentMailAnalysisSchema.parse(JSON.parse(raw));
      } catch {
        // Provider down or bad output: leave it for the next sync.
        continue;
      }
      analyzed += 1;
      await prisma.email.update({
        where: { id: email.id },
        data: { sentAnalyzedAt: now, expectsReply: analysis.expectsReply },
      });

      if (!createReminders) continue;
      const who = recipientsLabel(recipients, await knownNames(userId, recipients));
      for (const promise of analysis.promises) {
        const dueDate = resolvePromiseDate(promise, email.receivedAt);
        if (!dueDate) continue;
        const timing = computePromiseReminder({
          dueDate,
          dueTime: promise.dueTime,
          now,
          remindTime: settings.promiseRemindTime,
          sameDayLeadHours: settings.promiseSameDayLeadHours,
        });
        if (!timing) continue;
        const text = `You promised ${who}: ${promise.what}`.slice(0, 200);
        const reminder = await prisma.reminder.create({
          data: { userId, text, dueAt: timing.dueAt, remindAt: timing.remindAt, origin: "promise", sourceEmailId: email.id },
        });
        await activity.record(userId, {
          kind: "reminder_created",
          summary: `From your email "${email.subject}": reminder "${text}" — ${shortDayLabel(timing.remindAt)}, ${clockLabel(timing.remindAt)}`,
          undo: { reminderId: reminder.id },
        });
        reminders += 1;
      }
    }
    return { analyzed, reminders };
  }

  async function followUps(userId: string, refreshToken: string, now: Date, followUpDays: number): Promise<number> {
    const candidates = (
      await prisma.email.findMany({
        where: {
          userId,
          labels: { contains: SENT_LABEL_JSON },
          expectsReply: true,
          repliedAt: null,
          receivedAt: {
            gte: new Date(now.getTime() - FOLLOW_UP_MAX_AGE_DAYS * DAY_MS),
            lte: new Date(now.getTime() - followUpDays * DAY_MS),
          },
          OR: [
            { followUpCheckedAt: null },
            { followUpCheckedAt: { lt: new Date(now.getTime() - FOLLOW_UP_RECHECK_HOURS * 60 * 60_000) } },
          ],
        },
        orderBy: { receivedAt: "asc" },
      })
    ).filter(isSent);

    let created = 0;
    let checked = 0;
    for (const email of candidates) {
      if (await signals.findUniqueKey(userId, "follow_up", "sent_email", email.id)) continue;
      if (checked >= FOLLOW_UP_CHECK_LIMIT) break;
      checked += 1;

      // Replies already synced locally save a Gmail call.
      const local = await prisma.email.findMany({
        where: { userId, threadId: email.threadId, receivedAt: { gt: email.receivedAt } },
        select: { labels: true, receivedAt: true },
      });
      let thread = local.map((row) => ({ labels: decodeStringArray(row.labels), sentAt: row.receivedAt.getTime() }));
      if (decideFollowUp({ sentAt: email.receivedAt, now, followUpDays, threadMessages: thread }) === "nudge") {
        const remote = await gmail.listThreadMessages(refreshToken, email.threadId);
        thread = remote.map((message) => ({ labels: message.labels, sentAt: Number(message.internalDate ?? 0) }));
      }
      const decision = decideFollowUp({ sentAt: email.receivedAt, now, followUpDays, threadMessages: thread });
      await prisma.email.update({
        where: { id: email.id },
        data: { followUpCheckedAt: now, ...(decision === "replied" ? { repliedAt: now } : {}) },
      });
      if (decision !== "nudge") continue;

      const recipients = decodeStringArray(email.toEmails);
      const who = recipientsLabel(recipients, await knownNames(userId, recipients));
      const message = `You emailed ${who} ${daysAgoLabel(email.receivedAt, now)} about "${email.subject}" — no reply yet. Worth a nudge?`;
      const signal = await signals.create({
        userId,
        type: "follow_up",
        sourceType: "sent_email",
        sourceId: email.id,
        title: `No reply yet: ${email.subject}`.slice(0, 120),
        summary: message,
        dueAt: null,
        importanceHints: { emailId: email.id, threadId: email.threadId },
      });
      await interventions.create({
        userId,
        signalId: signal.id,
        priority: "medium",
        title: `No reply from ${who} yet`,
        message,
        reason: message,
        actionType: "open_source",
        actionPayload: {
          sourceUrl: `https://mail.google.com/mail/u/0/#all/${email.threadId}`,
          availableActions: ["DONE", "REMIND_LATER"],
        },
      });
      created += 1;
    }
    return created;
  }

  return {
    async process(userId: string, now: Date = new Date()): Promise<SentMailProcessResult> {
      const settings = await settingsService.get(userId);
      if (!settings.followUpEnabled && !settings.promiseRemindersEnabled) {
        return { synced: 0, analyzed: 0, promiseReminders: 0, followUps: 0 };
      }
      const refreshToken = await connection.getDecryptedRefreshToken(userId);
      const synced = await syncSent(userId, refreshToken, now);
      const { analyzed, reminders } = await analyze(userId, now, settings.promiseRemindersEnabled);
      const created = settings.followUpEnabled ? await followUps(userId, refreshToken, now, settings.followUpDays) : 0;
      return { synced, analyzed, promiseReminders: reminders, followUps: created };
    },
  };
}

export type SentMailService = ReturnType<typeof createSentMailService>;
