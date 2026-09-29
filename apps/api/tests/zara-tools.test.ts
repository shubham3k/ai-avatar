import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { findTool, ZARA_TOOLS, type ToolContext } from "../src/domain/chat/zara-tools.js";

// Friday 25 Sep 2026, 15:40 IST — tools format in local time, so pin the zone.
const originalTz = process.env.TZ;
const NOW = new Date("2026-09-25T10:10:00.000Z");
let userId: string;
let otherUserId: string;
let turnState: Map<string, unknown>;

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
  await prisma.user.deleteMany({ where: { email: { in: ["tools@example.local", "other@example.local"] } } });
}

function ctx(): ToolContext {
  return { prisma, userId, now: NOW, turnState, parseReminder };
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
