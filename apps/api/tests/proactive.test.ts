import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { createBriefingService, templateBriefing } from "../src/domain/proactive/briefing.service.js";
import { atLocalClock } from "../src/domain/proactive/local-time.js";
import { loadMeetingBrief } from "../src/domain/proactive/meeting-brief.js";
import { createProactiveSettingsService } from "../src/domain/proactive/proactive-settings.service.js";
import { createSentMailService } from "../src/domain/proactive/sent-mail.service.js";
import { createActivityService } from "../src/domain/activity/activity.service.js";
import type { GmailSentService, SentGmailMessage } from "../src/providers/google/gmail/gmail-sent.service.js";
import type { ChatRequest, LlmProvider } from "../src/providers/llm/llm-provider.js";

const USER_EMAIL = "proactive@example.local";
let userId: string;
const at = (date: string, clock: string) => atLocalClock(date, clock)!;
const DAY = 24 * 60 * 60_000;

async function cleanDb() {
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) return;
  await prisma.chatMessage.deleteMany({ where: { conversation: { userId: user.id } } });
  await prisma.conversation.deleteMany({ where: { userId: user.id } });
  await prisma.activityEntry.deleteMany({ where: { userId: user.id } });
  await prisma.proactiveSettings.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

function provider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    createStructuredCompletion: vi.fn(),
    transcribeAudio: vi.fn(),
    streamChat: vi.fn(),
    ...overrides,
  };
}

beforeEach(async () => {
  await cleanDb();
  userId = (await prisma.user.create({ data: { email: USER_EMAIL, displayName: "P", timezone: "UTC" } })).id;
  await prisma.integration.create({
    data: {
      userId,
      provider: "google",
      providerAccountEmail: "me@example.com",
      refreshTokenEncrypted: "x",
      scopes: "gmail.readonly",
    },
  });
});
afterAll(cleanDb);

describe("proactive settings (M5)", () => {
  it("starts with the ADR-006 defaults and saves changes", async () => {
    const service = createProactiveSettingsService();
    const defaults = await service.get(userId);
    expect(defaults).toMatchObject({
      briefingEnabled: true,
      briefingMode: "written",
      wrapUpTime: "18:00",
      followUpDays: 3,
      promiseRemindTime: "10:00",
      promiseSameDayLeadHours: 2,
      holdDuringFocus: true,
      quietHoursEnabled: false,
    });
    const updated = await service.update(userId, { followUpDays: 5, briefingMode: "both", wrapUpTime: undefined });
    expect(updated).toMatchObject({ followUpDays: 5, briefingMode: "both", wrapUpTime: "18:00" });
  });

  it("claims a day's briefing only once", async () => {
    const service = createProactiveSettingsService();
    expect(await service.claimDelivery(userId, "morning", "2026-09-29")).toBe(true);
    expect(await service.claimDelivery(userId, "morning", "2026-09-29")).toBe(false);
    expect(await service.claimDelivery(userId, "wrap_up", "2026-09-29")).toBe(true);
    expect(await service.claimDelivery(userId, "morning", "2026-09-30")).toBe(true);
  });
});

describe("morning briefing and wrap-up (M5)", () => {
  const morning = at("2026-09-29", "08:30");

  async function seedDay() {
    await prisma.calendarEvent.create({
      data: {
        userId,
        providerEventId: "ev1",
        calendarId: "primary",
        title: "Budget review",
        startAt: at("2026-09-29", "11:00"),
        endAt: at("2026-09-29", "12:00"),
        attendeeEmails: '["rahul@acme.com"]',
        attendees: JSON.stringify([
          { email: "me@example.com", displayName: "Me", responseStatus: "accepted" },
          { email: "rahul@acme.com", displayName: "Rahul Sharma", responseStatus: "accepted" },
        ]),
      },
    });
    await prisma.reminder.create({ data: { userId, text: "Call the bank", dueAt: at("2026-09-29", "15:00") } });
  }

  it("writes the day up from local data, saves it as a chat, and never repeats it the same day", async () => {
    await seedDay();
    let request: ChatRequest | null = null;
    const streamChat = vi.fn(async (req: ChatRequest) => {
      request = req;
      return { content: "Good morning! Budget review with Rahul at 11:00 AM.", toolCalls: [], provider: "openai" as const };
    });
    const service = createBriefingService({ provider: provider({ streamChat }) });

    const outcome = await service.deliver(userId, "morning", { now: morning });

    expect(outcome).toMatchObject({ delivered: true, kind: "morning", mode: "written", title: expect.stringMatching(/^Morning briefing · /) });
    const data = JSON.parse(request!.messages[1]!.content);
    expect(data.meetings).toEqual([{ time: "11:00 AM", title: "Budget review", with: ["Rahul Sharma"], status: "upcoming" }]);
    expect(data.remindersToday).toEqual([{ time: "3:00 PM", text: "Call the bank" }]);
    expect(request!.tools).toEqual([]);
    const saved = await prisma.chatMessage.findMany({ where: { conversationId: (outcome as { conversationId: string }).conversationId } });
    expect(saved.map((m) => [m.role, m.content, m.provider])).toEqual([
      ["assistant", "Good morning! Budget review with Rahul at 11:00 AM.", "openai"],
    ]);

    expect(await service.deliver(userId, "morning", { now: at("2026-09-29", "09:30") })).toEqual({ delivered: false });
    expect(await service.deliver(userId, "morning", { now: at("2026-09-29", "09:30"), force: true })).toMatchObject({ delivered: true });
  });

  it("isn't due outside its window, and falls back to a template if the AI is down", async () => {
    await seedDay();
    const streamChat = vi.fn().mockRejectedValue(new Error("down"));
    const service = createBriefingService({ provider: provider({ streamChat }) });

    expect(await service.deliver(userId, "wrap_up", { now: at("2026-09-29", "17:00") })).toEqual({ delivered: false });
    const outcome = await service.deliver(userId, "wrap_up", { now: at("2026-09-29", "18:05") });

    expect(outcome).toMatchObject({ delivered: true, kind: "wrap_up" });
    expect((outcome as { text: string }).text).toMatch(/That's a wrap/);
  });

  it("template: a clear day reads naturally", () => {
    expect(templateBriefing({ kind: "morning", today: "x", meetings: [], remindersToday: [], openAlerts: [], promisesDueSoon: [] })).toMatch(
      /day looks clear/,
    );
  });
});

describe("pre-meeting brief (M5)", () => {
  it("lists who's coming, recent emails with them, and open items that mention them", async () => {
    const now = at("2026-09-29", "10:50");
    await prisma.email.create({
      data: {
        userId,
        providerMessageId: "m1",
        threadId: "t1",
        fromEmail: "rahul@acme.com",
        fromName: "Rahul Sharma",
        toEmails: '["me@example.com"]',
        subject: "Q3 numbers",
        receivedAt: new Date(now.getTime() - DAY),
        labels: '["INBOX"]',
      },
    });
    await prisma.reminder.create({ data: { userId, text: "Send Rahul the deck", dueAt: new Date(now.getTime() + 2 * DAY) } });

    const brief = await loadMeetingBrief(
      userId,
      {
        organizerEmail: "me@example.com",
        organizerName: "Me",
        attendees: [
          { email: "rahul@acme.com", displayName: "Rahul Sharma", responseStatus: "accepted" },
          { email: "sam@acme.com", displayName: null, responseStatus: "declined" },
        ],
      },
      now,
    );

    expect(brief).toEqual({
      attendees: ["Rahul Sharma"],
      recentEmails: [{ from: "Rahul Sharma", subject: "Q3 numbers", when: "yesterday" }],
      openItems: ["Send Rahul the deck"],
    });
  });

  it("is null for a meeting with nobody else in it", async () => {
    expect(await loadMeetingBrief(userId, { organizerEmail: "me@example.com", organizerName: null, attendees: [] }, new Date())).toBeNull();
  });
});

describe("sent mail: promises and follow-ups (M5)", () => {
  const now = at("2026-09-29", "09:00");

  function sentMessage(overrides: Partial<SentGmailMessage>): SentGmailMessage {
    return {
      id: "s1",
      threadId: "th1",
      subject: "Budget",
      from: "Me <me@example.com>",
      to: "Rahul Sharma <rahul@acme.com>",
      date: new Date(now.getTime() - 4 * DAY).toISOString(),
      snippet: "Hi Rahul",
      labels: ["SENT"],
      internalDate: String(now.getTime() - 4 * DAY),
      bodyText: "Hi Rahul, can you confirm the Q3 budget? I'll send the deck by Friday.",
      ...overrides,
    };
  }

  function gmail(messages: SentGmailMessage[], thread: { labels: string[]; internalDate: string }[] = []): GmailSentService {
    return {
      listSentMessages: vi.fn().mockResolvedValue(messages),
      listThreadMessages: vi.fn().mockResolvedValue(thread.map((m, i) => ({ id: `x${i}`, ...m }))),
    };
  }

  const connection = { getDecryptedRefreshToken: vi.fn().mockResolvedValue("token") } as never;

  it("turns a promise into a reminder (day before at 10:00), logs it with undo, and nudges about the unanswered email", async () => {
    const createStructuredCompletion = vi.fn().mockResolvedValue(
      JSON.stringify({ expectsReply: true, promises: [{ what: "send the deck", when: "weekday", weekday: "friday", date: null, dueTime: null }] }),
    );
    const fakeGmail = gmail([sentMessage({})]);
    const service = createSentMailService({ connection, gmail: fakeGmail, provider: provider({ createStructuredCompletion }) });

    const result = await service.process(userId, now);

    expect(result).toEqual({ synced: 1, analyzed: 1, promiseReminders: 1, followUps: 1 });
    const input = createStructuredCompletion.mock.calls[0]![0].input as string;
    expect(input).toContain("I'll send the deck by Friday");
    expect(input).toContain("date 2026-09-25");

    const reminder = await prisma.reminder.findFirstOrThrow({ where: { userId } });
    expect(reminder).toMatchObject({ text: "You promised Rahul: send the deck", origin: "promise" });
    expect(reminder.remindAt).toEqual(at("2026-10-01", "10:00"));
    expect(reminder.dueAt).toEqual(at("2026-10-02", "17:00"));

    const [entry] = await createActivityService().list(userId);
    expect(entry).toMatchObject({ kind: "reminder_created", canUndo: true, summary: expect.stringContaining('"Budget"') });

    const nudge = await prisma.intervention.findFirstOrThrow({ where: { userId, signal: { type: "follow_up" } } });
    expect(nudge.title).toBe("No reply from Rahul yet");
    expect(nudge.message).toMatch(/4 days ago about "Budget"/);
    expect(fakeGmail.listThreadMessages).toHaveBeenCalledWith("token", "th1");

    // Nothing is analysed or nudged twice.
    const again = await service.process(userId, new Date(now.getTime() + 13 * 60 * 60_000));
    expect(again).toMatchObject({ analyzed: 0, promiseReminders: 0, followUps: 0 });
    expect(createStructuredCompletion).toHaveBeenCalledTimes(1);
  });

  it("doesn't nudge when they replied in the thread, or before the follow-up delay", async () => {
    const createStructuredCompletion = vi.fn().mockResolvedValue(JSON.stringify({ expectsReply: true, promises: [] }));
    const replied = gmail(
      [sentMessage({}), sentMessage({ id: "s2", threadId: "th2", internalDate: String(now.getTime() - DAY), date: new Date(now.getTime() - DAY).toISOString() })],
      [{ labels: ["INBOX"], internalDate: String(now.getTime() - 2 * DAY) }],
    );
    const result = await createSentMailService({ connection, gmail: replied, provider: provider({ createStructuredCompletion }) }).process(userId, now);

    expect(result.followUps).toBe(0);
    expect(await prisma.email.findFirst({ where: { userId, providerMessageId: "s1" } })).toMatchObject({ repliedAt: now });
    expect(replied.listThreadMessages).toHaveBeenCalledTimes(1); // the 1-day-old email wasn't checked yet
  });

  it("ignores past-due promises, and does nothing at all when both features are off", async () => {
    const createStructuredCompletion = vi.fn().mockResolvedValue(
      JSON.stringify({ expectsReply: false, promises: [{ what: "call back", when: "date", weekday: null, date: "2026-09-20", dueTime: null }] }),
    );
    const result = await createSentMailService({ connection, gmail: gmail([sentMessage({})]), provider: provider({ createStructuredCompletion }) }).process(userId, now);
    expect(result).toMatchObject({ analyzed: 1, promiseReminders: 0, followUps: 0 });

    await createProactiveSettingsService().update(userId, { followUpEnabled: false, promiseRemindersEnabled: false });
    const offGmail = gmail([sentMessage({ id: "s9" })]);
    expect(await createSentMailService({ connection, gmail: offGmail, provider: provider() }).process(userId, now)).toEqual({
      synced: 0,
      analyzed: 0,
      promiseReminders: 0,
      followUps: 0,
    });
    expect(offGmail.listSentMessages).not.toHaveBeenCalled();
  });

  it("leaves an email for the next sync when the AI output is invalid", async () => {
    const createStructuredCompletion = vi.fn().mockResolvedValue(JSON.stringify({ expectsReply: "maybe" }));
    const result = await createSentMailService({ connection, gmail: gmail([sentMessage({})]), provider: provider({ createStructuredCompletion }) }).process(userId, now);
    expect(result.analyzed).toBe(0);
    expect(await prisma.email.findFirst({ where: { userId } })).toMatchObject({ sentAnalyzedAt: null, bodyText: expect.stringContaining("Q3 budget") });
  });
});

describe("proactive API routes (M5)", () => {
  it("GET/PATCH /proactive/settings validates times and ranges", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const headers = { "x-user-id": userId };
    try {
      const initial = await app.inject({ method: "GET", url: "/api/v1/proactive/settings", headers });
      expect(initial.json()).toMatchObject({ followUpDays: 3, briefingMode: "written" });

      const bad = await app.inject({ method: "PATCH", url: "/api/v1/proactive/settings", headers, payload: { wrapUpTime: "25:00" } });
      expect(bad.statusCode).toBe(400);
      const badDays = await app.inject({ method: "PATCH", url: "/api/v1/proactive/settings", headers, payload: { followUpDays: 0 } });
      expect(badDays.statusCode).toBe(400);

      const ok = await app.inject({
        method: "PATCH",
        url: "/api/v1/proactive/settings",
        headers,
        payload: { wrapUpTime: "19:30", quietHoursEnabled: true },
      });
      expect(ok.json()).toMatchObject({ wrapUpTime: "19:30", quietHoursEnabled: true });
    } finally {
      await app.close();
    }
  }, 30_000);
});
