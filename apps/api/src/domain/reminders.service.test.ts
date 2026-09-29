import { describe, expect, it, vi } from "vitest";
import type { Reminder } from "@prisma/client";
import { createRemindersService } from "./reminders.service.js";
import type { RemindersRepository } from "../db/repositories/reminders.repository.js";
import type { ReminderParsingService } from "./reminder-parsing.service.js";
import type { AudioTranscriptionService } from "./audio-transcription.service.js";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "reminder_1",
    userId: "user_1",
    text: "Call the vendor about pricing",
    dueAt: new Date("2026-09-25T09:00:00.000Z"),
    remindAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRemindersRepo(overrides: Partial<RemindersRepository> = {}): RemindersRepository {
  return {
    create: vi.fn().mockResolvedValue(makeReminder()),
    listAll: vi.fn().mockResolvedValue([makeReminder()]),
    listDue: vi.fn().mockResolvedValue([makeReminder()]),
    findById: vi.fn().mockResolvedValue(makeReminder()),
    delete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("reminders service", () => {
  it("creates a reminder with trimmed text and a parsed due date", async () => {
    const reminders = makeRemindersRepo();
    const service = createRemindersService({ reminders });

    await service.createReminder(
      "user_1",
      { text: "  Call the vendor  ", dueAt: "2026-09-25T09:00:00.000Z" },
      NOW,
    );

    expect(reminders.create).toHaveBeenCalledWith({
      userId: "user_1",
      text: "Call the vendor",
      dueAt: new Date("2026-09-25T09:00:00.000Z"),
    });
  });

  it("rejects empty/whitespace-only text", async () => {
    const service = createRemindersService({ reminders: makeRemindersRepo() });

    await expect(
      service.createReminder("user_1", { text: "   ", dueAt: "2026-09-25T09:00:00.000Z" }, NOW),
    ).rejects.toThrow(/text is required/i);
  });

  it("rejects text over the max length", async () => {
    const service = createRemindersService({ reminders: makeRemindersRepo() });

    await expect(
      service.createReminder(
        "user_1",
        { text: "x".repeat(501), dueAt: "2026-09-25T09:00:00.000Z" },
        NOW,
      ),
    ).rejects.toThrow(/500 characters/);
  });

  it("rejects an unparseable due date", async () => {
    const service = createRemindersService({ reminders: makeRemindersRepo() });

    await expect(
      service.createReminder("user_1", { text: "ok", dueAt: "not-a-date" }, NOW),
    ).rejects.toThrow(/invalid/i);
  });

  it("rejects a due date meaningfully in the past", async () => {
    const service = createRemindersService({ reminders: makeRemindersRepo() });

    await expect(
      service.createReminder(
        "user_1",
        { text: "ok", dueAt: "2026-09-20T00:00:00.000Z" },
        NOW,
      ),
    ).rejects.toThrow(/future/i);
  });

  it("allows a due date a few seconds in the past (clock/latency grace window)", async () => {
    const reminders = makeRemindersRepo();
    const service = createRemindersService({ reminders });

    await expect(
      service.createReminder(
        "user_1",
        { text: "ok", dueAt: new Date(NOW.getTime() - 5_000).toISOString() },
        NOW,
      ),
    ).resolves.toBeDefined();
  });

  it("lists all reminders for the user", async () => {
    const reminders = makeRemindersRepo();
    const service = createRemindersService({ reminders });

    await service.listReminders("user_1");

    expect(reminders.listAll).toHaveBeenCalledWith("user_1");
  });

  it("deletes a reminder", async () => {
    const reminders = makeRemindersRepo();
    const service = createRemindersService({ reminders });

    await service.deleteReminder("user_1", "reminder_1");

    expect(reminders.delete).toHaveBeenCalledWith("user_1", "reminder_1");
  });

  it("throws not_found when deleting a reminder that doesn't exist (or isn't this user's)", async () => {
    const reminders = makeRemindersRepo({ delete: vi.fn().mockResolvedValue(false) });
    const service = createRemindersService({ reminders });

    await expect(service.deleteReminder("user_1", "missing")).rejects.toThrow(/not found/i);
  });
});

function makeParsingService(overrides: Partial<ReminderParsingService> = {}): ReminderParsingService {
  return {
    parse: vi.fn().mockResolvedValue({
      ok: true,
      reminderText: "Drink water",
      dueAt: new Date("2026-09-24T16:00:00.000Z"),
      remindAt: new Date("2026-09-24T15:50:00.000Z"),
    }),
    ...overrides,
  };
}

describe("reminders service — createReminderFromText", () => {
  it("stores the parser's dueAt and remindAt as-is (time math lives in reminder-timing.ts)", async () => {
    const reminders = makeRemindersRepo();
    const parsing = makeParsingService();
    const service = createRemindersService({ reminders, parsing });

    await service.createReminderFromText("user_1", { text: "meeting at 4pm" }, NOW);

    expect(parsing.parse).toHaveBeenCalledWith("meeting at 4pm", NOW);
    expect(reminders.create).toHaveBeenCalledWith({
      userId: "user_1",
      text: "Drink water",
      dueAt: new Date("2026-09-24T16:00:00.000Z"),
      remindAt: new Date("2026-09-24T15:50:00.000Z"),
    });
  });

  it("rejects empty/whitespace-only text before even calling the parser", async () => {
    const parsing = makeParsingService();
    const service = createRemindersService({ reminders: makeRemindersRepo(), parsing });

    await expect(
      service.createReminderFromText("user_1", { text: "   " }, NOW),
    ).rejects.toThrow(/text is required/i);
    expect(parsing.parse).not.toHaveBeenCalled();
  });

  it("surfaces a not_configured parse failure as a validation error", async () => {
    const parsing = makeParsingService({
      parse: vi.fn().mockResolvedValue({
        ok: false,
        code: "not_configured",
        message: "Add your Groq API key in Settings to create reminders.",
      }),
    });
    const service = createRemindersService({ reminders: makeRemindersRepo(), parsing });

    await expect(
      service.createReminderFromText("user_1", { text: "remind me to drink water at 4pm" }, NOW),
    ).rejects.toMatchObject({ code: "validation_error", statusCode: 400 });
  });

  it("surfaces a provider_error parse failure as an upstream error", async () => {
    const parsing = makeParsingService({
      parse: vi.fn().mockResolvedValue({
        ok: false,
        code: "provider_error",
        message: "Reminder parsing is temporarily unavailable. Try again shortly.",
      }),
    });
    const reminders = makeRemindersRepo();
    const service = createRemindersService({ reminders, parsing });

    await expect(
      service.createReminderFromText("user_1", { text: "remind me to drink water at 4pm" }, NOW),
    ).rejects.toMatchObject({ code: "upstream_error", statusCode: 502 });
    expect(reminders.create).not.toHaveBeenCalled();
  });

  it("surfaces a rejected Groq key as an upstream error carrying the user-facing message", async () => {
    const parsing = makeParsingService({
      parse: vi.fn().mockResolvedValue({
        ok: false,
        code: "auth_rejected",
        message: "Your Groq API key was rejected. Update it in Settings.",
      }),
    });
    const service = createRemindersService({ reminders: makeRemindersRepo(), parsing });

    await expect(
      service.createReminderFromText("user_1", { text: "remind me at 4pm" }, NOW),
    ).rejects.toMatchObject({
      code: "upstream_error",
      message: "Your Groq API key was rejected. Update it in Settings.",
    });
  });

  it("surfaces a missing time as a validation error", async () => {
    const parsing = makeParsingService({
      parse: vi.fn().mockResolvedValue({
        ok: false,
        code: "missing_time",
        message: "When should I remind you?",
      }),
    });
    const service = createRemindersService({ reminders: makeRemindersRepo(), parsing });

    await expect(
      service.createReminderFromText("user_1", { text: "remind me to call Rahul" }, NOW),
    ).rejects.toMatchObject({ code: "validation_error", message: "When should I remind you?" });
  });
});

function makeTranscriptionService(
  overrides: Partial<AudioTranscriptionService> = {},
): AudioTranscriptionService {
  return {
    transcribe: vi.fn().mockResolvedValue({ ok: true, text: "remind me to drink water at 4pm" }),
    ...overrides,
  };
}

describe("reminders service — createReminderFromVoice", () => {
  it("transcribes the audio, then creates a reminder via the same free-text parsing path", async () => {
    const reminders = makeRemindersRepo();
    const parsing = makeParsingService();
    const transcription = makeTranscriptionService();
    const service = createRemindersService({ reminders, parsing, transcription });

    await service.createReminderFromVoice(
      "user_1",
      { audioBase64: Buffer.from("fake-audio").toString("base64"), mimeType: "audio/webm" },
      NOW,
    );

    expect(transcription.transcribe).toHaveBeenCalledWith(
      Buffer.from("fake-audio"),
      "audio/webm",
      undefined,
    );
    expect(parsing.parse).toHaveBeenCalledWith("remind me to drink water at 4pm", NOW);
    expect(reminders.create).toHaveBeenCalledWith({
      userId: "user_1",
      text: "Drink water",
      dueAt: new Date("2026-09-24T16:00:00.000Z"),
      remindAt: new Date("2026-09-24T15:50:00.000Z"),
    });
  });

  it("rejects an empty audio payload before calling the transcription service", async () => {
    const transcription = makeTranscriptionService();
    const service = createRemindersService({
      reminders: makeRemindersRepo(),
      transcription,
    });

    await expect(
      service.createReminderFromVoice("user_1", { audioBase64: "", mimeType: "audio/webm" }, NOW),
    ).rejects.toThrow(/no audio/i);
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it("surfaces a transcription failure without calling the parser", async () => {
    const parsing = makeParsingService();
    const transcription = makeTranscriptionService({
      transcribe: vi.fn().mockResolvedValue({
        ok: false,
        code: "empty",
        message: "Didn't catch anything — try recording again.",
      }),
    });
    const service = createRemindersService({
      reminders: makeRemindersRepo(),
      parsing,
      transcription,
    });

    await expect(
      service.createReminderFromVoice(
        "user_1",
        { audioBase64: Buffer.from("audio").toString("base64"), mimeType: "audio/webm" },
        NOW,
      ),
    ).rejects.toThrow(/didn't catch anything/i);
    expect(parsing.parse).not.toHaveBeenCalled();
  });
});
