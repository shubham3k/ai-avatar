/**
 * Explicit "remember this" requests (English, Hindi, Hinglish, common typos).
 * When one is found, the agent's first model turn must call a tool — the
 * model can't just *say* "I'll remember" without saving it (seen live on
 * Sept 29, 2026: "my name is shubham remembar that" → "I'll remember your
 * name for this conversation", nothing stored). "Required", not
 * "remember_fact": "remember to call Rahul at 5" is really a reminder.
 */
const REMEMBER_PATTERNS: RegExp[] = [
  /\b(remember|remembar|remeber|rember|rmbr)\b/i,
  /\byaad\s+(rakh|rakho|rakhna|rakhiye|rakhen|rakhe|kar\s*lo|kar\s*lena|kar\s*lijiye)\b/i,
  /याद\s*(रख|कर\s*ल)/,
  /\b(make\s+a\s+note|note\s+(that|this|it|down))\b/i,
  /\b(don'?t|do\s+not)\s+forget\b/i,
  /\b(bhoolna\s+mat|mat\s+bhoolna|bhulna\s+mat|mat\s+bhulna)\b/i,
  /\bmy\s+name\s+is\b/i,
  /\bmera\s+naam\b/i,
  /मेरा\s+नाम/,
  /\bcall\s+me\s+\w+/i,
];

/** Questions about the past ("do you remember…", "yaad hai?") are recall, not a request to save. */
const RECALL_PATTERNS: RegExp[] = [
  /\b(do|did|can|could)\s+you\s+remember\b/i,
  /\bremember\s+(when|what|who|where|how|if)\b/i,
  /\byaad\s+hai\b/i,
];

export function isExplicitRememberRequest(text: string): boolean {
  if (RECALL_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return REMEMBER_PATTERNS.some((pattern) => pattern.test(text));
}
