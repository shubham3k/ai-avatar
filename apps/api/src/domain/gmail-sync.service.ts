import {
  createEmailsRepository,
  type EmailsRepository,
} from "../db/repositories/emails.repository.js";
import { clampGmailLimit } from "./gmail-messages.service.js";
import {
  createGoogleConnectionService,
  type GoogleConnectionService,
} from "./google-connection.service.js";
import { prisma } from "../lib/prisma.js";
import {
  createGmailService,
  type GmailService,
} from "../providers/google/gmail/gmail.service.js";
import type { NormalizedGmailMessage } from "../providers/google/gmail/gmail.types.js";

export interface GmailSyncResult {
  fetched: number;
  created: number;
  updated: number;
}

const NO_SUBJECT = "(no subject)";

/** Pulls a bare email address out of a "Name <email>" or plain "email" token. */
function extractEmailAddress(token: string): string {
  const match = token.match(/<([^>]+)>/);
  return (match ? match[1]! : token).trim();
}

function parseFromHeader(raw: string | null): {
  fromEmail: string;
  fromName: string | null;
} {
  if (!raw || raw.trim().length === 0) {
    return { fromEmail: "", fromName: null };
  }
  const match = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim() ?? "";
    return { fromEmail: match[2]!.trim(), fromName: name.length > 0 ? name : null };
  }
  return { fromEmail: raw.trim(), fromName: null };
}

function parseAddressList(raw: string | null): string[] {
  if (!raw || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((token) => extractEmailAddress(token))
    .filter((email) => email.length > 0);
}

/**
 * Gmail's `Date` header is what we show, but it can be missing or malformed.
 * `internalDate` (epoch ms) is always present on the message resource, so it's
 * a reliable fallback; the current time is a last resort so persistence never
 * fails outright over a timestamp.
 */
function resolveReceivedAt(message: NormalizedGmailMessage): Date {
  if (message.date) {
    const parsed = new Date(message.date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (message.internalDate) {
    const epoch = Number(message.internalDate);
    if (Number.isFinite(epoch) && epoch > 0) return new Date(epoch);
  }
  return new Date();
}

function toEmailInput(userId: string, message: NormalizedGmailMessage, now: Date) {
  const { fromEmail, fromName } = parseFromHeader(message.from);
  return {
    userId,
    providerMessageId: message.id,
    threadId: message.threadId,
    fromEmail,
    fromName,
    toEmails: parseAddressList(message.to),
    subject: message.subject && message.subject.trim().length > 0 ? message.subject : NO_SUBJECT,
    snippet: message.snippet,
    receivedAt: resolveReceivedAt(message),
    isRead: !message.labels.includes("UNREAD"),
    labels: message.labels,
    sourceUrl: `https://mail.google.com/mail/u/0/#all/${message.id}`,
    rawUpdatedAt: now,
  };
}

export function createGmailSyncService(dependencies?: {
  connection?: GoogleConnectionService;
  gmail?: GmailService;
  emails?: EmailsRepository;
}) {
  const connection = dependencies?.connection ?? createGoogleConnectionService();
  const gmail = dependencies?.gmail ?? createGmailService();
  const emails = dependencies?.emails ?? createEmailsRepository(prisma);

  return {
    async sync(userId: string, requestedLimit?: number): Promise<GmailSyncResult> {
      const refreshToken = await connection.getDecryptedRefreshToken(userId);
      const limit = clampGmailLimit(requestedLimit);
      const messages = await gmail.listRecentMessages(refreshToken, limit);

      const now = new Date();
      const inputs = messages.map((message) => toEmailInput(userId, message, now));
      const tally = await emails.upsertMany(inputs);

      return { fetched: messages.length, ...tally };
    },
  };
}

export type GmailSyncService = ReturnType<typeof createGmailSyncService>;
