/**
 * Deterministic correlation rules for cross-source (Gmail ↔ Calendar)
 * context. No fuzzy/ML matching — plain normalized token overlap with
 * obvious noise words removed, and exact sender/attendee email matching.
 */

/** Recent emails older than this are not considered for correlation. */
export const EMAIL_WINDOW_DAYS = 14;

/** Upcoming events further out than this are not considered for correlation. */
export const CALENDAR_WINDOW_DAYS = 7;

/** Bounded fetch size before the date-window filter narrows it further. */
export const CONTEXT_FETCH_LIMIT = 25;

/** Tokens shorter than this are treated as noise. */
export const MIN_TOKEN_LENGTH = 4;

/**
 * Generic words that carry no topical signal on their own. Explicitly
 * includes the words called out as false-positive risks: "meeting",
 * "project", "update", etc.
 */
export const STOP_WORDS = new Set([
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "your",
  "about",
  "please",
  "thanks",
  "thank",
  "hello",
  "regarding",
  "meeting",
  "meetings",
  "project",
  "projects",
  "update",
  "updates",
  "call",
  "calls",
  "sync",
  "syncs",
  "review",
  "reviews",
  "discussion",
  "discussions",
  "catchup",
  "check",
  "quick",
  "question",
  "today",
  "tomorrow",
  "week",
  "weekly",
]);

/** Lowercases, strips punctuation, drops stop words and short tokens. */
export function extractMeaningfulTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH)
    .filter((token) => !STOP_WORDS.has(token));
  return new Set(tokens);
}

export function tokenOverlap(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((token) => b.has(token));
}
