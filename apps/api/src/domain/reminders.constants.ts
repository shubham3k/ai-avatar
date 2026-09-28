// Shared between reminders.service.ts and reminder-parsing.service.ts —
// kept in its own module so neither has to import the other (avoids a
// circular import: reminders.service.ts depends on
// reminder-parsing.service.ts for createReminderFromText, and
// reminder-parsing.service.ts needs this same length limit to validate
// Groq's output).
export const REMINDER_TEXT_MAX_LENGTH = 500;
