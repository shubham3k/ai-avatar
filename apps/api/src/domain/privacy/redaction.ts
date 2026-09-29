/**
 * Deterministic redaction (ADR-006 §1): sensitive details are never sent to
 * an AI provider and never stored in memory — passwords/PINs/OTPs, bank and
 * card numbers, and government ID numbers (Aadhaar, PAN, passport). Runs on
 * every piece of text before it leaves the PC (user messages, history, tool
 * results such as email snippets, memory) — a code-level guarantee, not a
 * prompt instruction.
 *
 * Deliberately conservative: better to mask a harmless number next to the
 * word "OTP" than to leak a real one.
 */

export const REDACTED = "[redacted]";

/** Luhn check — separates real card numbers from arbitrary long digit runs. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

interface Rule {
  name: string;
  pattern: RegExp;
  /** Optional extra check on the match (e.g. Luhn); default: always redact. */
  accept?: (match: string) => boolean;
  /** Replace only this capture group (keeping the keyword for context); default: whole match. */
  group?: number;
}

const RULES: Rule[] = [
  // "password is hunter2", "pwd: x9!", "PIN - 4821", "passcode 1234"
  {
    name: "secret",
    pattern: /\b(?:password|passwd|pwd|passcode|pin|security answer)\b\s*(?:is|:|=|-)?\s*(\S+)/gi,
    group: 1,
  },
  // "OTP is 482913", "your one-time password: 9981", "verification code 55213"
  {
    name: "otp",
    pattern: /\b(?:otp|one[- ]time (?:password|code)|verification code|security code|auth(?:entication)? code)\b[^\d\n]{0,20}(\d{4,8})\b/gi,
    group: 1,
  },
  // Card numbers: 13–19 digits, optionally grouped by spaces/dashes, Luhn-valid.
  {
    name: "card",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    accept: (match) => passesLuhn(match.replace(/\D/g, "")),
  },
  // Aadhaar: exactly 12 digits, usually 4-4-4 — not the first 12 digits of a longer number.
  { name: "aadhaar", pattern: /(?<!\d[ -]?)\b\d{4}[ -]?\d{4}[ -]?\d{4}\b(?![ -]?\d)/g },
  // PAN: ABCDE1234F
  { name: "pan", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  // Bank account numbers, when labelled as such.
  {
    name: "bank_account",
    pattern: /\b(?:a\/c|acct|account)(?:\s*(?:no|number|#))?\.?\s*(?:is|:)?\s*(\d{9,18})\b/gi,
    group: 1,
  },
  // Passport numbers, when labelled as such (Indian format: letter + 7 digits).
  {
    name: "passport",
    pattern: /\bpassport\b(?:\s*(?:no|number|#))?\.?\s*(?:is|:)?\s*([A-Z]\d{7})\b/gi,
    group: 1,
  },
];

export interface RedactionResult {
  text: string;
  /** Which kinds of detail were masked (empty when nothing was). */
  found: string[];
}

export function redactSensitive(input: string): RedactionResult {
  let text = input;
  const found = new Set<string>();
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match: string, ...groups: unknown[]) => {
      const target = rule.group ? (groups[rule.group - 1] as string | undefined) : match;
      if (!target || target === REDACTED) return match;
      if (rule.accept && !rule.accept(target)) return match;
      found.add(rule.name);
      return rule.group ? match.replace(target, REDACTED) : REDACTED;
    });
  }
  return { text, found: [...found] };
}

/** Convenience for when only the masked text is needed. */
export function redact(input: string): string {
  return redactSensitive(input).text;
}

export function containsSensitive(input: string): boolean {
  return redactSensitive(input).found.length > 0;
}
