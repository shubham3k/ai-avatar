/**
 * Deterministic keyword/phrase rules for actionable-email detection.
 * Every phrase is matched as a case-insensitive substring against
 * `subject + " " + snippet`, never on subject or snippet alone.
 */

export interface PhraseRule {
  /** Stable, human-readable id surfaced in `matchedRules`. */
  id: string;
  phrase: string;
}

/**
 * HIGH confidence: explicit response requests, confirmation/deadline
 * language, or the sender explicitly saying they're waiting.
 */
export const HIGH_CONFIDENCE_RULES: PhraseRule[] = [
  { id: "waiting_for_response", phrase: "waiting for your response" },
  { id: "waiting_for_response", phrase: "waiting for a response" },
  { id: "waiting_to_hear", phrase: "waiting to hear from you" },
  { id: "please_confirm", phrase: "please confirm" },
  { id: "please_respond", phrase: "please respond" },
  { id: "need_your_approval", phrase: "need your approval" },
  { id: "need_your_feedback", phrase: "need your feedback" },
  { id: "need_your_input", phrase: "need your input" },
  { id: "need_your_response", phrase: "need your response" },
  { id: "need_your_confirmation", phrase: "need your confirmation" },
  { id: "need_your_signoff", phrase: "need your sign off" },
  { id: "need_your_signoff", phrase: "need your signoff" },
];

/**
 * MEDIUM confidence: weaker/softer request language. On its own it's a
 * plausible ask, but less certain than the HIGH-confidence phrases above.
 */
export const MEDIUM_CONFIDENCE_RULES: PhraseRule[] = [
  { id: "can_you", phrase: "can you" },
  { id: "could_you", phrase: "could you" },
  { id: "can_we", phrase: "can we" },
  { id: "would_you", phrase: "would you" },
  { id: "let_me_know", phrase: "let me know" },
  { id: "following_up", phrase: "following up" },
  { id: "when_can_you", phrase: "when can you" },
  { id: "are_you_available", phrase: "are you available" },
];

/**
 * Senders that are almost never a personal request — automated,
 * transactional, or bulk mail. Matched as a substring of the address's
 * local part (before the @), so "notifications+abc@x.com" and
 * "team-noreply@x.com" both match.
 */
export const EXCLUDED_SENDER_TOKENS: string[] = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "notification",
  "newsletter",
  "marketing",
  "mailer-daemon",
  "bounce",
  "digest",
];

/**
 * Gmail's own categorization is a reliable, already-computed signal for
 * "this isn't a personal request" — no need to re-derive it ourselves.
 */
export const EXCLUDED_GMAIL_LABELS: string[] = [
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
  "SPAM",
  "TRASH",
];

/** How many days back a message is still considered "reasonably recent". */
export const ACTIONABLE_EMAIL_WINDOW_DAYS = 14;

export function isExcludedSender(fromEmail: string): boolean {
  const localPart = fromEmail.split("@")[0]?.toLowerCase() ?? "";
  if (!localPart) return false;
  return EXCLUDED_SENDER_TOKENS.some((token) => localPart.includes(token));
}

export function isExcludedByLabels(labels: string[]): boolean {
  const upper = labels.map((label) => label.toUpperCase());
  return EXCLUDED_GMAIL_LABELS.some((excluded) => upper.includes(excluded));
}

function findMatches(text: string, rules: PhraseRule[]): string[] {
  const matchedIds = new Set<string>();
  for (const rule of rules) {
    if (text.includes(rule.phrase)) matchedIds.add(rule.id);
  }
  return [...matchedIds];
}

export function matchHighConfidenceRules(text: string): string[] {
  return findMatches(text, HIGH_CONFIDENCE_RULES);
}

export function matchMediumConfidenceRules(text: string): string[] {
  return findMatches(text, MEDIUM_CONFIDENCE_RULES);
}
