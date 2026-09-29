import { google, type gmail_v1 } from "googleapis";
import { mapGoogleApiError } from "../google-api-error.js";
import { createGoogleOAuthService, type GoogleOAuthService } from "../oauth/google-oauth.service.js";
import type { NormalizedGmailMessage } from "./gmail.types.js";

/** Stored body text is capped — enough for promise detection, never whole threads. */
export const SENT_BODY_MAX_CHARS = 4000;

export interface SentGmailMessage extends NormalizedGmailMessage {
  /** Plain-text body with quoted replies and signatures-by-marker removed, trimmed; null when there is none. */
  bodyText: string | null;
}

export interface ThreadMessageMeta {
  id: string;
  labels: string[];
  /** Epoch ms as a string, like Gmail's own type. */
  internalDate: string | null;
}

/**
 * ADR-006 M5: read-only access to the user's sent mail (for follow-ups and
 * promises) and to thread metadata (to see whether someone replied). Uses
 * the existing gmail.readonly scope — no new consent.
 */
export interface GmailSentService {
  listSentMessages(refreshToken: string, options: { newerThanDays: number; limit: number }): Promise<SentGmailMessage[]>;
  listThreadMessages(refreshToken: string, threadId: string): Promise<ThreadMessageMeta[]>;
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | null {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function findPart(part: gmail_v1.Schema$MessagePart | undefined, mimeType: string): string | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/**
 * Keeps only what the user wrote: drops the quoted conversation below
 * ("On Tue, … wrote:", "-----Original Message-----", "> " lines) and a
 * "-- " signature, then trims to SENT_BODY_MAX_CHARS.
 */
export function extractOwnText(raw: string): string | null {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^On .{4,200} wrote:$/i.test(trimmed) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed)) break;
    if (/^From: .+/.test(trimmed) && kept.some((l) => l.trim() === "")) break;
    if (trimmed === "--" || trimmed === "-- ") break;
    if (trimmed.startsWith(">")) continue;
    kept.push(line);
  }
  const text = kept.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return null;
  return text.length > SENT_BODY_MAX_CHARS ? text.slice(0, SENT_BODY_MAX_CHARS) : text;
}

export function messageBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string | null {
  const plain = findPart(payload, "text/plain");
  if (plain) return extractOwnText(plain);
  const html = findPart(payload, "text/html");
  return html ? extractOwnText(htmlToText(html)) : null;
}

export function createGmailSentService(dependencies?: { oauth?: GoogleOAuthService }): GmailSentService {
  const oauth = dependencies?.oauth ?? createGoogleOAuthService();

  return {
    async listSentMessages(refreshToken, options) {
      const gmail = google.gmail({ version: "v1", auth: oauth.createAuthorizedClient(refreshToken) });
      let refs: gmail_v1.Schema$Message[];
      try {
        const res = await gmail.users.messages.list({
          userId: "me",
          q: `in:sent newer_than:${Math.max(1, Math.trunc(options.newerThanDays))}d`,
          maxResults: Math.max(1, Math.min(options.limit, 50)),
        });
        refs = res.data.messages ?? [];
      } catch (err) {
        throw mapGoogleApiError(err, "Gmail");
      }

      const messages: SentGmailMessage[] = [];
      for (const ref of refs) {
        if (!ref.id) continue;
        try {
          const { data } = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "full" });
          const headers = data.payload?.headers ?? undefined;
          const date = header(headers, "Date");
          const parsed = date ? new Date(date) : null;
          messages.push({
            id: data.id ?? ref.id,
            threadId: data.threadId ?? "",
            subject: header(headers, "Subject"),
            from: header(headers, "From"),
            to: [header(headers, "To"), header(headers, "Cc")].filter(Boolean).join(", ") || null,
            date: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
            snippet: data.snippet ?? null,
            labels: data.labelIds ?? [],
            internalDate: data.internalDate ?? null,
            bodyText: messageBodyText(data.payload ?? undefined),
          });
        } catch (err) {
          const mapped = mapGoogleApiError(err, "Gmail");
          if ((mapped as { statusCode?: number }).statusCode === 403) throw mapped;
          // One unreadable message is skipped, not fatal.
        }
      }
      return messages;
    },

    async listThreadMessages(refreshToken, threadId) {
      const gmail = google.gmail({ version: "v1", auth: oauth.createAuthorizedClient(refreshToken) });
      try {
        const { data } = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
          format: "metadata",
          metadataHeaders: ["From"],
        });
        return (data.messages ?? []).map((message) => ({
          id: message.id ?? "",
          labels: message.labelIds ?? [],
          internalDate: message.internalDate ?? null,
        }));
      } catch (err) {
        throw mapGoogleApiError(err, "Gmail");
      }
    },
  };
}
