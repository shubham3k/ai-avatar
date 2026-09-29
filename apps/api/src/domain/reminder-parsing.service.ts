import { z } from "zod";
import {
  classifyGroqFailure,
  createGroqProvider,
  groqFailureDetail,
  type GroqProvider,
} from "../providers/groq/groq-client.js";
import {
  REMINDER_PARSE_PROMPT_VERSION,
  REMINDER_PARSE_SYSTEM_PROMPT,
} from "../providers/groq/reminder-parse-prompt.js";
import { buildReminderParseJsonSchema } from "../providers/groq/reminder-parse-schema.js";
import { REMINDER_TEXT_MAX_LENGTH } from "./reminders.constants.js";
import { formatLocalNow, resolveReminderTiming } from "./reminder-timing.js";

export type ReminderParseFailureCode =
  | "not_configured"
  | "auth_rejected"
  | "model_unavailable"
  | "provider_error"
  | "malformed_output"
  | "missing_time"
  | "time_in_past";

export type ReminderParseOutcome =
  | { ok: true; reminderText: string; dueAt: Date; remindAt: Date }
  | { ok: false; code: ReminderParseFailureCode; message: string };

const MAX_PROVIDER_ATTEMPTS = 2;
const DEFAULT_REMINDER_TEXT = "Reminder";

const reminderIntentSchema = z.object({
  reminderText: z.string(),
  kind: z.enum(["ping", "event"]),
  timeType: z.enum(["relative", "clock", "none"]),
  relativeMinutes: z.number().nullable(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  leadMinutes: z.number().nullable(),
});

/**
 * User-facing messages — shown as-is in the desktop Settings panel, so they
 * say what to do next, never expose provider internals. Shared with
 * audio-transcription.service.ts for the provider failure cases.
 */
export const REMINDER_FAILURE_MESSAGES = {
  not_configured: "Add your Groq API key in Settings to create reminders.",
  auth_rejected: "Your Groq API key was rejected. Update it in Settings.",
  model_unavailable:
    "The AI model this app uses is no longer available on Groq. The app needs an update.",
  provider_error: "Groq is busy or unreachable right now. Try again in a moment.",
  malformed_output:
    "Couldn't work out a reminder from that. Try rephrasing, e.g. \"remind me at 4pm to call Rahul\".",
  missing_time: "When should I remind you? Add a time, like \"at 4pm\" or \"in 10 minutes\".",
  time_in_past: "That time has already passed. Try a time in the future.",
} as const satisfies Record<ReminderParseFailureCode, string>;

/** `detail` (e.g. "HTTP 429 rate_limit_exceeded") is appended so provider failures can be diagnosed from the screen. */
function failure(code: ReminderParseFailureCode, detail: string | null = null): ReminderParseOutcome {
  const base = REMINDER_FAILURE_MESSAGES[code];
  return { ok: false, code, message: detail ? `${base} (Groq: ${detail})` : base };
}

/**
 * Turns free text ("remind me to drink water at 4pm") into a reminder.
 * Groq extracts intent only (what kind of time was said, ping vs event —
 * docs/decisions/ADR-005-reminder-timing.md); reminder-timing.ts computes
 * dueAt/remindAt deterministically in local time.
 */
export function createReminderParsingService(dependencies?: { provider?: GroqProvider }) {
  const provider = dependencies?.provider ?? createGroqProvider();

  return {
    async parse(text: string, now: Date = new Date()): Promise<ReminderParseOutcome> {
      const request = {
        instructions: REMINDER_PARSE_SYSTEM_PROMPT,
        input: JSON.stringify({ now: formatLocalNow(now), text }),
        schemaName: `reminder_parse_${REMINDER_PARSE_PROMPT_VERSION}`,
        jsonSchema: buildReminderParseJsonSchema(),
        // The intent JSON is ~60–80 tokens; ample headroom, well under Groq's per-minute budget.
        maxOutputTokens: 300,
      };

      let raw: string | null = null;
      // One retry for transient failures (rate limits, an occasional
      // structured-output validation miss) — observed in live testing. A
      // missing or rejected key won't fix itself, so those fail fast.
      for (let attempt = 1; raw === null; attempt += 1) {
        try {
          raw = await provider.createStructuredCompletion(request);
        } catch (err) {
          const kind = classifyGroqFailure(err);
          if (kind === "not_configured") return failure("not_configured");
          if (kind === "auth_rejected") return failure("auth_rejected");
          if (kind === "model_unavailable") {
            return failure("model_unavailable", groqFailureDetail(err));
          }
          // A rate-limit refusal (429) won't clear within an immediate retry —
          // retrying just spends the per-minute budget again.
          const detail = groqFailureDetail(err);
          if (attempt >= MAX_PROVIDER_ATTEMPTS || detail?.startsWith("HTTP 429")) {
            return failure("provider_error", detail);
          }
        }
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return failure("malformed_output");
      }

      const intentResult = reminderIntentSchema.safeParse(parsed);
      if (!intentResult.success) return failure("malformed_output");
      const intent = intentResult.data;

      // "to stretch" → "stretch": a leftover of "remind me to …" the model sometimes keeps.
      // "Remind me in 5 minutes" names no task at all — that's a valid
      // request, so it gets a generic label rather than being rejected.
      const reminderText =
        intent.reminderText.trim().replace(/^to\s+/i, "") || DEFAULT_REMINDER_TEXT;
      if (reminderText.length > REMINDER_TEXT_MAX_LENGTH) {
        return failure("malformed_output");
      }

      const timing = resolveReminderTiming(intent, now);
      if (!timing.ok) {
        return failure(timing.code === "invalid_time" ? "malformed_output" : timing.code);
      }

      return { ok: true, reminderText, dueAt: timing.dueAt, remindAt: timing.remindAt };
    },
  };
}

export type ReminderParsingService = ReturnType<typeof createReminderParsingService>;
