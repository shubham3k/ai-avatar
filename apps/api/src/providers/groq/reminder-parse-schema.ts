/**
 * Builds the JSON Schema handed to Groq's Structured Outputs feature for
 * parsing a free-text reminder into an *intent* (see
 * docs/decisions/ADR-005-reminder-timing.md) — the model never computes
 * timestamps; domain/reminder-timing.ts does.
 */
export function buildReminderParseJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reminderText: { type: "string" },
      kind: { type: "string", enum: ["ping", "event"] },
      timeType: { type: "string", enum: ["relative", "clock", "none"] },
      relativeMinutes: { type: ["integer", "null"] },
      date: { type: ["string", "null"] },
      time: { type: ["string", "null"] },
      leadMinutes: { type: ["integer", "null"] },
    },
    required: [
      "reminderText",
      "kind",
      "timeType",
      "relativeMinutes",
      "date",
      "time",
      "leadMinutes",
    ],
  } as const;
}
