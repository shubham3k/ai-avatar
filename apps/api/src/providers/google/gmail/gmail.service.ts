import { google, type gmail_v1 } from "googleapis";
import { mapGoogleApiError } from "../google-api-error.js";
import {
  createGoogleOAuthService,
  type GoogleOAuthService,
} from "../oauth/google-oauth.service.js";
import {
  GMAIL_MAX_MESSAGE_LIMIT,
  type NormalizedGmailMessage,
} from "./gmail.types.js";

const METADATA_HEADERS = ["Subject", "From", "To", "Date"];

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const match = headers.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  );
  return match?.value ?? null;
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function normalizeMessage(
  message: gmail_v1.Schema$Message,
): NormalizedGmailMessage {
  const headers = message.payload?.headers ?? undefined;
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    subject: getHeader(headers, "Subject"),
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    date: normalizeDate(getHeader(headers, "Date")),
    snippet: message.snippet ?? null,
    labels: message.labelIds ?? [],
    internalDate: message.internalDate ?? null,
  };
}

function mapGmailError(err: unknown): Error {
  return mapGoogleApiError(err, "Gmail");
}

export interface GmailService {
  listRecentMessages(
    refreshToken: string,
    limit: number,
  ): Promise<NormalizedGmailMessage[]>;
}

export function createGmailService(dependencies?: {
  oauth?: GoogleOAuthService;
}): GmailService {
  const oauth = dependencies?.oauth ?? createGoogleOAuthService();

  return {
    async listRecentMessages(refreshToken, limit) {
      const safeLimit = Math.max(
        1,
        Math.min(limit, GMAIL_MAX_MESSAGE_LIMIT),
      );

      const auth = oauth.createAuthorizedClient(refreshToken);
      const gmail = google.gmail({ version: "v1", auth });

      let messageRefs: gmail_v1.Schema$Message[];
      try {
        const listRes = await gmail.users.messages.list({
          userId: "me",
          maxResults: safeLimit,
        });
        messageRefs = listRes.data.messages ?? [];
      } catch (err) {
        throw mapGmailError(err);
      }

      const messages: NormalizedGmailMessage[] = [];
      for (const ref of messageRefs) {
        if (!ref.id) continue;
        try {
          const messageRes = await gmail.users.messages.get({
            userId: "me",
            id: ref.id,
            format: "metadata",
            metadataHeaders: METADATA_HEADERS,
          });
          messages.push(normalizeMessage(messageRes.data));
        } catch (err) {
          const mapped = mapGmailError(err);
          // Auth-level failures apply to every subsequent call too; stop early.
          if (mapped instanceof Error && "statusCode" in mapped) {
            const statusCode = (mapped as { statusCode?: number }).statusCode;
            if (statusCode === 403) throw mapped;
          }
          // Otherwise this single message is unreadable/malformed; skip it
          // rather than failing the whole request.
        }
      }

      return messages;
    },
  };
}
