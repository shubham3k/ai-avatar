import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { createActivityService } from "../src/domain/activity/activity.service.js";
import { describeSchedule, nextRunAfter } from "../src/domain/routines/routine-schedule.js";
import { createRoutinesService, type RoutineRunner } from "../src/domain/routines/routines.service.js";
import { createZaraAgentService } from "../src/domain/chat/zara-agent.service.js";
import type { ChatRequest, LlmProvider } from "../src/providers/llm/llm-provider.js";

const USER_EMAIL = "routines@example.local";
let userId: string;
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

async function cleanDb() {
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) return;
  await prisma.routine.deleteMany({ where: { userId: user.id } });
  await prisma.activityEntry.deleteMany({ where: { userId: user.id } });
  await prisma.intervention.deleteMany({ where: { userId: user.id } });
  await prisma.signal.deleteMany({ where: { userId: user.id } });
  await prisma.chatMessage.deleteMany({ where: { conversation: { userId: user.id } } });
  await prisma.conversation.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

beforeEach(async () => {
  await cleanDb();
  userId = (await prisma.user.create({ data: { email: USER_EMAIL, displayName: "R", timezone: "UTC" } })).id;
});
afterAll(cleanDb);

describe("routine schedules (M9)", () => {
  const tuesdayMorning = local(2026, 9, 29, 8, 0); // Tue 29 Sep 2026

  it("works out the next run in local time", () => {
    expect(nextRunAfter({ frequency: "daily", time: "09:00" }, tuesdayMorning)).toEqual(local(2026, 9, 29, 9, 0));
    expect(nextRunAfter({ frequency: "daily", time: "07:00" }, tuesdayMorning)).toEqual(local(2026, 9, 30, 7, 0));
    expect(nextRunAfter({ frequency: "weekdays", time: "18:00" }, local(2026, 10, 2, 19, 0))).toEqual(local(2026, 10, 5, 18, 0)); // Fri evening → Mon
    expect(nextRunAfter({ frequency: "weekly", time: "09:00", weekdays: [1] }, tuesdayMorning)).toEqual(local(2026, 10, 5, 9, 0));
    expect(nextRunAfter({ frequency: "weekly", time: "09:00", weekdays: [2, 4] }, local(2026, 9, 29, 10, 0))).toEqual(local(2026, 10, 1, 9, 0));
    expect(nextRunAfter({ frequency: "monthly", time: "10:00", dayOfMonth: 31 }, local(2027, 2, 1))).toEqual(local(2027, 2, 28, 10, 0));
    expect(nextRunAfter({ frequency: "once", at: local(2026, 9, 29, 7, 0).toISOString() }, tuesdayMorning)).toBeNull();
  });

  it("describes schedules in plain words", () => {
    expect(describeSchedule({ frequency: "weekly", time: "09:00", weekdays: [1, 4] })).toBe("Every Monday and Thursday at 9:00 AM");
    expect(describeSchedule({ frequency: "weekdays", time: "18:30" })).toBe("Every weekday at 6:30 PM");
    expect(describeSchedule({ frequency: "monthly", time: "10:00", dayOfMonth: 1 })).toBe("Monthly on the 1st at 10:00 AM");
  });
});

function parsingProvider(parse: object): LlmProvider {
  return {
    createStructuredCompletion: vi.fn().mockResolvedValue(JSON.stringify(parse)),
    transcribeAudio: vi.fn(),
    streamChat: vi.fn(),
  };
}

const MONDAY_SUMMARY = {
  title: "Unanswered emails summary",
  instruction: "Summarize the emails from the last week I haven't replied to.",
  frequency: "weekly",
  weekdays: ["monday"],
  dayOfMonth: null,
  time: "09:00",
  onceWhen: null,
  takesAction: false,
};

describe("routines service (M9)", () => {
  const now = local(2026, 9, 29, 8, 0);

  it("creates a routine from plain words, logged with Undo", async () => {
    const service = createRoutinesService({ provider: parsingProvider(MONDAY_SUMMARY), runner: vi.fn() });
    const routine = await service.create(userId, "every Monday at 9, summarize unanswered emails", now);
    expect(routine).toMatchObject({
      title: "Unanswered emails summary",
      scheduleText: "Every Monday at 9:00 AM",
      takesAction: false,
      enabled: true,
      nextRunAt: local(2026, 10, 5, 9, 0).toISOString(),
    });
    const activity = createActivityService();
    const [entry] = await activity.list(userId);
    expect(entry).toMatchObject({ kind: "routine_created", canUndo: true });
    await activity.undo(userId, entry!.id);
    expect(await service.list(userId)).toEqual([]);
  });

  it("runs a due routine once, moves it to the next slot, and leaves a 'ready' card that opens the report", async () => {
    const runner: RoutineRunner = vi.fn(async () => ({ conversationId: null, reply: "3 emails need a reply:\n- Rahul — budget", cards: 0, failed: false }));
    const service = createRoutinesService({ provider: parsingProvider(MONDAY_SUMMARY), runner });
    await service.create(userId, "every Monday at 9, summarize unanswered emails", now);

    const monday = local(2026, 10, 5, 9, 1);
    const [first, second] = await Promise.all([service.runDue(monday, { wait: true }), service.runDue(monday, { wait: true })]);
    expect(first + second).toBe(1);
    expect(runner).toHaveBeenCalledOnce();

    const [routine] = await service.list(userId);
    expect(routine).toMatchObject({ nextRunAt: local(2026, 10, 12, 9, 0).toISOString(), lastStatus: "ok" });
    const card = await prisma.intervention.findFirstOrThrow({ where: { userId } });
    expect(card).toMatchObject({ title: "Unanswered emails summary — ready", priority: "medium" });
    expect(card.message).toContain("3 emails need a reply");
  });

  it("an action routine's run that prepared cards asks for approval; paused routines don't run", async () => {
    const runner: RoutineRunner = vi.fn(async () => {
      const conversation = await prisma.conversation.create({ data: { userId, title: "Routine run" } });
      return { conversationId: conversation.id, reply: "Drafted 2 follow-ups — approve them.", cards: 2, failed: false };
    });
    const service = createRoutinesService({
      provider: parsingProvider({ ...MONDAY_SUMMARY, title: "Follow-ups", takesAction: true, frequency: "daily", weekdays: [] }),
      runner,
    });
    const routine = await service.create(userId, "every day at 9 send follow-ups", now);
    expect(routine.takesAction).toBe(true);

    await service.runDue(local(2026, 9, 29, 9, 5), { wait: true });
    const card = await prisma.intervention.findFirstOrThrow({ where: { userId } });
    expect(card).toMatchObject({ title: "Follow-ups — needs your approval", priority: "high", actionType: "open_chat" });

    await service.update(userId, routine.id, { enabled: false }, now);
    expect(await service.runDue(local(2026, 9, 30, 9, 5), { wait: true })).toBe(0);
  });

  it("one-off routines switch off after their run; reschedule understands new words", async () => {
    const reminderParser = { parse: vi.fn().mockResolvedValue({ ok: true, reminderText: "x", dueAt: local(2026, 10, 2, 17, 0), remindAt: local(2026, 10, 2, 17, 0) }) };
    const service = createRoutinesService({
      provider: parsingProvider({ ...MONDAY_SUMMARY, frequency: "once", weekdays: [], time: null, onceWhen: "friday at 5pm" }),
      reminderParser: reminderParser as never,
      runner: vi.fn(async () => ({ conversationId: null, reply: "Done", cards: 0, failed: false })),
    });
    const routine = await service.create(userId, "on friday at 5pm remind me of the offsite plan", now);
    expect(routine.scheduleText).toMatch(/^Once, /);
    await service.runDue(local(2026, 10, 2, 17, 1), { wait: true });
    expect((await service.list(userId))[0]).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it("a failed run says so; delete can be undone", async () => {
    const service = createRoutinesService({
      provider: parsingProvider({ ...MONDAY_SUMMARY, frequency: "daily", weekdays: [] }),
      runner: vi.fn(async () => {
        throw new Error("model down");
      }),
    });
    const routine = await service.create(userId, "every day at 9 summarize", now);
    await service.runDue(local(2026, 9, 29, 9, 5), { wait: true });
    expect((await prisma.intervention.findFirstOrThrow({ where: { userId } })).title).toMatch(/didn't finish/);

    await service.remove(userId, routine.id);
    const activity = createActivityService();
    const deleted = (await activity.list(userId)).find((entry) => entry.kind === "routine_deleted")!;
    await activity.undo(userId, deleted.id);
    expect((await service.list(userId)).map((r) => r.title)).toEqual(["Unanswered emails summary"]);
  });
});

describe("routine runs inside the agent (M9)", () => {
  it("a run can't create routines or approve anything, and is saved as a 'Routine:' chat", async () => {
    const requests: ChatRequest[] = [];
    const provider: LlmProvider = {
      createStructuredCompletion: vi.fn(),
      transcribeAudio: vi.fn(),
      streamChat: vi.fn(async (request: ChatRequest, onDelta: (d: string) => void) => {
        requests.push(structuredClone(request));
        onDelta("Weekly summary\n- Nothing urgent");
        return { content: "Weekly summary\n- Nothing urgent", toolCalls: [], provider: "openai" as const };
      }),
    };
    const titles: string[] = [];
    await createZaraAgentService({ provider }).sendMessage(
      userId,
      { text: "Summarize last week's unanswered emails.", routineTitle: "Unanswered emails summary" },
      (event) => {
        if (event.type === "conversation") titles.push(event.title);
      },
    );
    const names = requests[0]!.tools.map((tool) => tool.name);
    expect(names).not.toContain("create_routine");
    expect(names).not.toContain("approve_calendar_in_chat");
    expect(names).toContain("draft_email");
    expect(requests[0]!.messages[0]!.content).toContain('scheduled run of the user\'s routine "Unanswered emails summary"');
    expect(titles[0]).toMatch(/^Routine: Unanswered emails summary · /);
  });
});
