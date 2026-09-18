export const GMAIL_DEFAULT_MESSAGE_LIMIT = 10;
export const GMAIL_MAX_MESSAGE_LIMIT = 25;

export interface NormalizedGmailMessage {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  snippet: string | null;
  labels: string[];
  /**
   * Gmail's own delivery timestamp (epoch ms, as a string — matches the
   * Gmail API's own type). Present on every message regardless of headers,
   * so it's a reliable fallback when the `Date` header is missing/unparsable.
   */
  internalDate: string | null;
}
