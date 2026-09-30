import { google } from "googleapis";
import { mapGoogleApiError } from "../google-api-error.js";
import { createGoogleOAuthService, type GoogleOAuthService } from "../oauth/google-oauth.service.js";

/**
 * ADR-006 M7: sending mail (gmail.send scope). Only ever called by the
 * approval layer after the user clicked Approve and the 30-second undo
 * window passed — never directly by the model.
 */
export interface OutgoingEmail {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** Reply threading: the original's Message-ID (and its References chain). */
  inReplyTo?: string | null;
  references?: string | null;
  threadId?: string | null;
}

/** RFC 2047 encoded-word for non-ASCII headers (Hindi subjects etc.). */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf-8").toString("base64")}?=`;
}

/** Header-injection safe: addresses are validated upstream; newlines are stripped here too. */
function addressList(addresses: string[]): string {
  return addresses.map((address) => address.replace(/[\r\n,;<>]/g, "").trim()).join(", ");
}

/** A plain-text UTF-8 MIME message, base64url-encoded for the Gmail API. */
export function buildRawMessage(email: OutgoingEmail): string {
  const headers = [
    `To: ${addressList(email.to)}`,
    ...(email.cc.length ? [`Cc: ${addressList(email.cc)}`] : []),
    `Subject: ${encodeHeader(email.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    ...(email.inReplyTo ? [`In-Reply-To: ${email.inReplyTo.replace(/[\r\n]/g, "")}`] : []),
    ...(email.inReplyTo || email.references
      ? [`References: ${[email.references, email.inReplyTo].filter(Boolean).join(" ").replace(/[\r\n]/g, "")}`]
      : []),
  ];
  const body = Buffer.from(email.body.replace(/\r?\n/g, "\r\n"), "utf-8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf-8").toString("base64url");
}

export interface GmailSendService {
  send(refreshToken: string, email: OutgoingEmail): Promise<{ id: string; threadId: string | null }>;
  /** Message-ID/References of a message being replied to. */
  replyHeaders(refreshToken: string, providerMessageId: string): Promise<{ messageId: string | null; references: string | null }>;
}

export function createGmailSendService(dependencies?: { oauth?: GoogleOAuthService }): GmailSendService {
  const oauth = dependencies?.oauth ?? createGoogleOAuthService();
  return {
    async send(refreshToken, email) {
      const gmail = google.gmail({ version: "v1", auth: oauth.createAuthorizedClient(refreshToken) });
      try {
        const res = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: buildRawMessage(email), ...(email.threadId ? { threadId: email.threadId } : {}) },
        });
        return { id: res.data.id ?? "", threadId: res.data.threadId ?? null };
      } catch (err) {
        throw mapGoogleApiError(err, "Gmail");
      }
    },
    async replyHeaders(refreshToken, providerMessageId) {
      const gmail = google.gmail({ version: "v1", auth: oauth.createAuthorizedClient(refreshToken) });
      try {
        const { data } = await gmail.users.messages.get({
          userId: "me",
          id: providerMessageId,
          format: "metadata",
          metadataHeaders: ["Message-ID", "References"],
        });
        const headers = data.payload?.headers ?? [];
        const find = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
        return { messageId: find("Message-ID"), references: find("References") };
      } catch (err) {
        throw mapGoogleApiError(err, "Gmail");
      }
    },
  };
}
