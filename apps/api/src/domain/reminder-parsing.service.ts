import { z } from "zod";
import {
  classifyLlmFailure,
  llmFailureDetail,
  type LlmProvider,
} from "../providers/llm/llm-provider.js";
import { createDefaultLlmProvider } from "./llm-usage.service.js";
import { providerFailureMessage, type ProviderFailureCode } from "./llm-failure-messages.js";
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
 * User-facing messages for failures that aren't about the provider — shown
 * as-is in the desktop app. Provider failures are worded by
 * llm-failure-messages.ts so they name whichever provider actually failed.
 */
export const REMINDER_FAILURE_MESSAGES = {
  malformed_output:
    "Couldn't work out a reminder from that. Try rephrasing, e.g. \"remind me at 4pm to call Rahul\".",
  missing_time: "When should I remind you? Add a time, like \"at 4pm\" or \"in 10 minutes\".",
  time_in_past: "That time has already passed. Try a time in the future.",
} as const satisfies Record<Exclude<ReminderParseFailureCode, ProviderFailureCode>, string>;

function failure(code: keyof typeof REMINDER_FAILURE_MESSAGES): ReminderParseOutcome {
  return { ok: false, code, message: REMINDER_FAILURE_MESSAGES[code] };
}

function providerFailure(code: ProviderFailureCode, err: unknown): ReminderParseOutcome {
  return { ok: false, code, message: providerFailureMessage(code, err, "reminders") };
}

/**
 * Turns free text ("remind me to drink water at 4pm") into a reminder.
 * The model extracts intent only (what kind of time was said, ping vs event —
 * docs/decisions/ADR-005-reminder-timing.md); reminder-timing.ts computes
 * dueAt/remindAt deterministically in local time.
 */
export function createReminderParsingService(dependencies?: { provider?: LlmProvider }) {
  const provider = dependencies?.provider ?? createDefaultLlmProvider();

  return {
    async parse(text: string, now: Date = new Date()): Promise<ReminderParseOutcome> {
      const request = {
        instructions: REMINDER_PARSE_SYSTEM_PROMPT,
        input: JSON.stringify({ now: formatLocalNow(now), text }),
        schemaName: `reminder_parse_${REMINDER_PARSE_PROMPT_VERSION}`,
        jsonSchema: buildReminderParseJsonSchema(),
        // The intent JSON is ~60–80 tokens; ample headroom, well under Groq's per-minute budget.
        maxOutputTokens: 300,
        operation: "reminder_parse" as const,
      };

      let raw: string | null = null;
      // One retry for transient failures (rate limits, an occasional
      // structured-output validation miss) — observed in live testing. A
      // missing or rejected key won't fix itself, so those fail fast.
      for (let attempt = 1; raw === null; attempt += 1) {
        try {
          raw = await provider.createStructuredCompletion(request);
        } catch (err) {
          const kind = classifyLlmFailure(err);
          if (kind === "not_configured" || kind === "auth_rejected" || kind === "model_unavailable") {
            return providerFailure(kind, err);
          }
          // A rate-limit refusal (429) won't clear within an immediate retry —
          // retrying just spends the per-minute budget again.
          if (attempt >= MAX_PROVIDER_ATTEMPTS || llmFailureDetail(err)?.startsWith("HTTP 429")) {
            return providerFailure("provider_error", err);
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
