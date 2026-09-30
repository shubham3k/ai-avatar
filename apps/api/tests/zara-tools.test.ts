import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { findTool, ZARA_TOOLS, type ToolContext } from "../src/domain/chat/zara-tools.js";
import { createActivityService } from "../src/domain/activity/activity.service.js";
import { createMemoryService } from "../src/domain/memory/memory.service.js";

// Friday 25 Sep 2026, 15:40 IST — tools format in local time, so pin the zone.
const originalTz = process.env.TZ;
const NOW = new Date("2026-09-25T10:10:00.000Z");
let userId: string;
let otherUserId: string;
let turnState: Map<string, unknown>;
let incognito = false;

/** Stands in for reminder-parsing.service.ts (tested on its own) — no real model call. */
const parseReminder = vi.fn(async (text: string) => {
  if (text.includes("gym")) {
    // Tomorrow 09:00 IST.
    const at = new Date("2026-09-26T03:30:00.000Z");
    return { ok: true as const, reminderText: "go to the gym", dueAt: at, remindAt: at };
  }
  if (text.includes("meeting")) {
    return {
      ok: true as const,
      reminderText: "meeting",
      dueAt: new Date("2026-09-25T11:30:00.000Z"),
      remindAt: new Date("2026-09-25T11:20:00.000Z"),
    };
  }
  return { ok: false as const, code: "missing_time" as const, message: "When should I remind you?" };
});

async function cleanDb() {
  await prisma.reminder.deleteMany();
  await prisma.email.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.intervention.deleteMany();
  await prisma.signal.deleteMany();
  await prisma.memoryFact.deleteMany();
  await prisma.activityEntry.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany({ where: { email: { in: ["tools@example.local", "other@example.local"] } } });
}

function ctx(): ToolContext {
  return {
    prisma,
    userId,
    now: NOW,
    turnState,
    parseReminder,
    memory: createMemoryService({ prisma }),
    recordActivity: (entry) => createActivityService({ prisma }).record(userId, entry),
    incognito,
  };
}

async function run(name: string, args: unknown) {
  const tool = findTool(name)!;
  return tool.run(tool.schema.parse(args), ctx()) as Promise<Record<string, unknown>>;
}

function event(title: string, startAt: Date, owner = userId) {
  return prisma.calendarEvent.create({
    data: {
      userId: owner,
      providerEventId: title,
      calendarId: "primary",
      title,
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60_000),
      attendeeEmails: "[]",
    },
  });
}

function email(subject: string, fromName: string, receivedAt: Date, overrides: Record<string, unknown> = {}) {
  return prisma.email.create({
    data: {
      userId,
      providerMessageId: subject,
      threadId: subject,
      fromEmail: `${fromName.toLowerCase()}@example.com`,
      fromName,
      toEmails: "[]",
      subject,
      snippet: `About ${subject}`,
      receivedAt,
      ...overrides,
    },
  });
}

describe("Zara tools (ADR-006 M2)", () => {
  beforeAll(() => {
    process.env.TZ = "Asia/Kolkata";
  });
  afterAll(async () => {
    process.env.TZ = originalTz;
    await cleanDb();
  });

  beforeEach(async () => {
    await cleanDb();
    turnState = new Map();
    incognito = false;
    parseReminder.mockClear();
    userId = (await prisma.user.create({ data: { email: "tools@example.local", displayName: "T", timezone: "Asia/Kolkata" } })).id;
    otherUserId = (await prisma.user.create({ data: { email: "other@example.local", displayName: "O", timezone: "UTC" } })).id;
  });

  it("every tool definition is an object schema with a unique name", () => {
    const names = ZARA_TOOLS.map((tool) => tool.definition.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of ZARA_TOOLS) expect(tool.definition.parameters).toMatchObject({ type: "object" });
  });

  it("get_calendar_events returns today's events in local time, only the user's own", async () => {
    await event("Team sync", new Date("2026-09-25T10:30:00.000Z")); // 4:00 PM IST today
    await event("Tomorrow standup", new Date("2026-09-26T04:00:00.000Z"));
    await event("Someone else's", new Date("2026-09-25T11:00:00.000Z"), otherUserId);
    const cancelled = await event("Cancelled call", new Date("2026-09-25T12:00:00.000Z"));
    await prisma.calendarEvent.update({ where: { id: cancelled.id }, data: { status: "cancelled" } });

    const result = await run("get_calendar_events", {});

    expect(result.events).toEqual([expect.objectContaining({ title: "Team sync", start: "Fri, Sep 25, 4:00 PM" })]);
  });

  it("get_calendar_events covers a multi-day range", async () => {
    await event("Tomorrow standup", new Date("2026-09-26T04:00:00.000Z"));
    const result = await run("get_calendar_events", { startDate: "2026-09-25", days: 2 });
    expect(result.events).toHaveLength(1);
  });

  it("search_emails applies both the word and sender filters, newest first, with short snippets only", async () => {
    await email("Invoice for September", "Rahul", new Date("2026-09-24T10:00:00.000Z"));
    await email("Invoice reminder", "Priya", new Date("2026-09-24T11:00:00.000Z"));
    await email("Lunch", "Rahul", new Date("2026-09-24T12:00:00.000Z"), { bodyText: "full body must never be returned" });

    const result = await run("search_emails", { query: "Invoice", from: "Rahul" });

    expect(result.emails).toEqual([expect.objectContaining({ subject: "Invoice for September", unread: true })]);
    expect(JSON.stringify(result)).not.toContain("full body");
  });

  it("search_emails respects the lookback window", async () => {
    await email("Old news", "Rahul", new Date("2026-09-01T10:00:00.000Z"));
    expect((await run("search_emails", { days: 7 })).emails).toEqual([]);
  });

  it("create_reminder hands the user's words to the reminder parser and stores the resolved times", async () => {
    const gym = await run("create_reminder", { request: "kal subah 9 baje gym jaana hai" });
    expect(parseReminder).toHaveBeenCalledWith("kal subah 9 baje gym jaana hai", NOW);
    expect(gym.created).toMatchObject({ text: "go to the gym", alertAt: "Sat, Sep 26, 9:00 AM" });

    const meeting = await run("create_reminder", { request: "meeting at 5pm" });
    expect(meeting.created).toMatchObject({ alertAt: "Fri, Sep 25, 4:50 PM", dueAt: "Fri, Sep 25, 5:00 PM" });

    expect(((await run("list_reminders", {})).reminders as unknown[]).length).toBe(2);
  });

  it("create_reminder won't duplicate a reminder if the model repeats the call within one message", async () => {
    await run("create_reminder", { request: "gym tomorrow 9am" });
    const repeat = await run("create_reminder", { request: "gym tomorrow 9am" });

    expect(repeat).toMatchObject({ alreadyCreated: { text: "go to the gym" } });
    expect(await prisma.reminder.count()).toBe(1);
  });

  it("create_reminder passes the parser's message through instead of guessing", async () => {
    expect(await run("create_reminder", { request: "call mom" })).toEqual({ error: "When should I remind you?" });
    expect(await prisma.reminder.count()).toBe(0);
  });

  it("delete_reminder only deletes the user's own reminders", async () => {
    const mine = await prisma.reminder.create({ data: { userId, text: "mine", dueAt: new Date("2026-09-26T00:00:00Z") } });
    const theirs = await prisma.reminder.create({
      data: { userId: otherUserId, text: "theirs", dueAt: new Date("2026-09-26T00:00:00Z") },
    });

    expect(await run("delete_reminder", { reminderId: theirs.id })).toEqual({ error: "No reminder with that id." });
    expect(await run("delete_reminder", { reminderId: mine.id })).toEqual({ deleted: { text: "mine" } });
    expect(await prisma.reminder.count()).toBe(1);
  });

  it("list_attention_items lists pending alerts", async () => {
    const signal = await prisma.signal.create({
      data: { userId, type: "user_action_required", sourceType: "reminder", sourceId: "x", title: "Pay rent", summary: "Pay rent", status: "open" },
    });
    await prisma.intervention.create({
      data: { userId, signalId: signal.id, priority: "high", title: "Pay rent", message: "Pay rent today", reason: "r", actionType: "none" },
    });

    expect((await run("list_attention_items", {})).items).toEqual([
      { title: "Pay rent", detail: "Pay rent today", priority: "high" },
    ]);
  });
});

describe("Zara memory + activity tools (ADR-006 M3)", () => {
  beforeEach(async () => {
    await cleanDb();
    turnState = new Map();
    incognito = false;
    userId = (await prisma.user.create({ data: { email: "tools@example.local", displayName: "T", timezone: "UTC" } })).id;
  });
  afterAll(cleanDb);

  it("remember_fact saves a fact once, logs it, and refuses sensitive details", async () => {
    expect(await run("remember_fact", { fact: "Rahul is the user's manager", category: "people" })).toEqual({
      saved: "Rahul is the user's manager",
    });
    expect(await run("remember_fact", { fact: "rahul is the user's manager", category: "people" })).toEqual({
      alreadyKnown: "Rahul is the user's manager",
    });
    expect(await run("remember_fact", { fact: "User's bank PIN: 4821", category: "about_you" })).toMatchObject({
      error: expect.stringMatching(/sensitive/),
    });

    expect(await prisma.memoryFact.count()).toBe(1);
    const log = await prisma.activityEntry.findMany();
    expect(log.map((e) => [e.kind, e.summary])).toEqual([["memory_saved", 'Remembered: "Rahul is the user\'s manager"']]);
  });

  it("update_fact and forget_fact change memory and log undoable entries", async () => {
    await run("remember_fact", { fact: "Prefers meetings after 10am", category: "preferences" });
    const fact = await prisma.memoryFact.findFirstOrThrow();

    expect(await run("update_fact", { factId: fact.id, fact: "Prefers meetings after 11am" })).toEqual({
      updated: "Prefers meetings after 11am",
    });
    expect(await run("forget_fact", { factId: fact.id })).toEqual({ forgotten: "Prefers meetings after 11am" });
    expect(await run("forget_fact", { factId: fact.id })).toMatchObject({ error: expect.any(String) });

    const kinds = (await prisma.activityEntry.findMany({ orderBy: { createdAt: "asc" } })).map((e) => e.kind);
    expect(kinds).toEqual(["memory_saved", "memory_updated", "memory_deleted"]);
  });

  it("memory-writing tools refuse in incognito chats", async () => {
    incognito = true;
    expect(await run("remember_fact", { fact: "Likes tea", category: "preferences" })).toMatchObject({
      error: expect.stringMatching(/incognito/),
    });
    expect(await prisma.memoryFact.count()).toBe(0);
  });

  it("creating and deleting reminders is logged with undo data", async () => {
    await run("create_reminder", { request: "gym tomorrow" });
    const reminder = await prisma.reminder.findFirstOrThrow();
    await run("delete_reminder", { reminderId: reminder.id });

    const log = await prisma.activityEntry.findMany({ orderBy: { createdAt: "asc" } });
    expect(log.map((e) => e.kind)).toEqual(["reminder_created", "reminder_deleted"]);
    expect(log.every((e) => e.undo !== null)).toBe(true);
  });

  it("search_chats finds words in the user's past conversations only", async () => {
    const conversation = await prisma.conversation.create({ data: { userId, title: "Vendor pricing" } });
    await prisma.chatMessage.create({
      data: { conversationId: conversation.id, role: "assistant", content: "The vendor quoted 40k for the redesign." },
    });

    const result = await run("search_chats", { query: "vendor" });
    expect(result.matches).toEqual([expect.objectContaining({ chat: "Vendor pricing", from: "Zara" })]);
  });
});
