import {
  createGoogleConnectionService,
  type GoogleConnectionService,
} from "./google-connection.service.js";
import {
  createGmailService,
  type GmailService,
} from "../providers/google/gmail/gmail.service.js";
import {
  GMAIL_DEFAULT_MESSAGE_LIMIT,
  GMAIL_MAX_MESSAGE_LIMIT,
  type NormalizedGmailMessage,
} from "../providers/google/gmail/gmail.types.js";

export function clampGmailLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return GMAIL_DEFAULT_MESSAGE_LIMIT;
  }
  return Math.max(1, Math.min(Math.trunc(requested), GMAIL_MAX_MESSAGE_LIMIT));
}

export function createGmailMessagesService(dependencies?: {
  connection?: GoogleConnectionService;
  gmail?: GmailService;
}) {
  const connection = dependencies?.connection ?? createGoogleConnectionService();
  const gmail = dependencies?.gmail ?? createGmailService();

  return {
    async listRecentMessages(
      userId: string,
      requestedLimit?: number,
    ): Promise<NormalizedGmailMessage[]> {
      const refreshToken = await connection.getDecryptedRefreshToken(userId);
      const limit = clampGmailLimit(requestedLimit);
      return gmail.listRecentMessages(refreshToken, limit);
    },
  };
}

export type GmailMessagesService = ReturnType<typeof createGmailMessagesService>;
