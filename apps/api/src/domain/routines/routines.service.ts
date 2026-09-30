import type { PrismaClient, Routine } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { notFoundError, validationError } from "../../lib/errors.js";
import {
  createInterventionsRepository,
  createSignalsRepository,
} from "../../db/repositories/interventions.repository.js";
import type { LlmProvider } from "../../providers/llm/llm-provider.js";
import { createActivityService, type ActivityService } from "../activity/activity.service.js";
import { createDefaultLlmProvider } from "../llm-usage.service.js";
import { createReminderParsingService, type ReminderParsingService } from "../reminder-parsing.service.js";
import { buildRoutineParseJsonSchema, ROUTINE_PARSE_INSTRUCTIONS, routineParseSchema } from "./routine-parse.js";
import { describeSchedule, nextRunAfter, routineScheduleSchema, WEEKDAY_NAMES, type RoutineSchedule } from "./routine-schedule.js";

export interface RoutineDto {
  id: string;
  title: string;
  instruction: string;
  schedule: RoutineSchedule;
  scheduleText: string;
  takesAction: boolean;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export interface RoutineDraft {
  title: string;
  instruction: string;
  schedule: RoutineSchedule;
  takesAction: boolean;
}

/** What running a routine needs from the chat agent (injected, so tests don't call a model). */
export type RoutineRunner = (
  userId: string,
  routine: { title: string; instruction: string },
) => Promise<{ conversationId: string | null; reply: string; cards: number; failed: boolean }>;

function toDto(row: Routine): RoutineDto {
  const schedule = routineScheduleSchema.parse(JSON.parse(row.schedule));
  return {
    id: row.id,
    title: row.title,
    instruction: row.instruction,
    schedule,
    scheduleText: describeSchedule(schedule),
    takesAction: row.takesAction,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
  };
}

/** Default runner: Zara's own agent loop, in "routine" mode (loaded lazily — the agent also uses this service). */
const agentRunner: RoutineRunner = async (userId, routine) => {
  const { createZaraAgentService } = await import("../chat/zara-agent.service.js");
  let conversationId: string | null = null;
  let reply = "";
  let cards = 0;
  let failed = false;
  await createZaraAgentService().sendMessage(
    userId,
    { text: routine.instruction, routineTitle: routine.title },
    (event) => {
      if (event.type === "conversation") conversationId = event.id;
      else if (event.type === "done") reply = event.message.content;
      else if (event.type === "action" && event.action.status === "pending") cards += 1;
      else if (event.type === "error") failed = true;
    },
  );
  return { conversationId, reply, cards, failed };
};

/**
 * ADR-006 §10 — routines. Created in plain language, run on schedule in
 * the background. A run is Zara's normal agent with the routine's
 * instruction: reading tools just run; anything that sends or changes
 * something only produces approval cards (so action routines ask every
 * run — nothing in a routine can approve itself). Each run ends with a
 * card saying it's ready, or that it needs approval.
 */
export function createRoutinesService(dependencies?: {
  prisma?: PrismaClient;
  provider?: LlmProvider;
  reminderParser?: ReminderParsingService;
  activity?: ActivityService;
  runner?: RoutineRunner;
}) {
  const prisma = dependencies?.prisma ?? defaultPrisma;
  const activity = dependencies?.activity ?? createActivityService({ prisma });
  const runner = dependencies?.runner ?? agentRunner;
  const signals = createSignalsRepository(prisma);
  const interventions = createInterventionsRepository(prisma);
  let provider = dependencies?.provider ?? null;
  let reminderParser = dependencies?.reminderParser ?? null;
  const running = new Set<string>();

  async function find(userId: string, id: string): Promise<Routine> {
    const row = await prisma.routine.findFirst({ where: { id, userId } });
    if (!row) throw notFoundError("That routine isn't there any more.");
    return row;
  }

  async function understand(text: string, now: Date): Promise<{ ok: true; draft: RoutineDraft } | { ok: false; message: string }> {
    provider ??= createDefaultLlmProvider();
    let parsed;
    try {
      const raw = await provider.createStructuredCompletion({
        instructions: ROUTINE_PARSE_INSTRUCTIONS,
        input: `Today is ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.\n\nRequest: ${text}`,
        schemaName: "routine",
        jsonSchema: buildRoutineParseJsonSchema(),
        maxOutputTokens: 300,
        operation: "other",
      });
      parsed = routineParseSchema.parse(JSON.parse(raw));
    } catch {
      return { ok: false, message: "I couldn't work out that routine — try e.g. \"every Monday at 9, summarize unanswered emails\"." };
    }
    let schedule: RoutineSchedule;
    const time = parsed.time ?? "09:00";
    switch (parsed.frequency) {
      case "once": {
        reminderParser ??= createReminderParsingService({ provider });
        const when = await reminderParser.parse(parsed.onceWhen ?? text, now);
        if (!when.ok) return { ok: false, message: "When should it run? Say a day and time." };
        schedule = { frequency: "once", at: when.dueAt.toISOString() };
        break;
      }
      case "weekly": {
        const weekdays = [...new Set(parsed.weekdays.map((day) => WEEKDAY_NAMES.indexOf(day)))];
        if (weekdays.length === 0) return { ok: false, message: "Which day of the week should it run?" };
        schedule = { frequency: "weekly", time, weekdays };
        break;
      }
      case "monthly":
        if (!parsed.dayOfMonth) return { ok: false, message: "Which day of the month should it run?" };
        schedule = { frequency: "monthly", time, dayOfMonth: parsed.dayOfMonth };
        break;
      default:
        schedule = { frequency: parsed.frequency, time };
    }
    return { ok: true, draft: { title: parsed.title, instruction: parsed.instruction, schedule, takesAction: parsed.takesAction } };
  }

  async function deliver(userId: string, routine: Routine, runId: string, outcome: Awaited<ReturnType<RoutineRunner>>) {
    const needsApproval = outcome.cards > 0;
    const title = outcome.failed
      ? `${routine.title} — didn't finish`
      : needsApproval
        ? `${routine.title} — needs your approval`
        : `${routine.title} — ready`;
    const message = outcome.failed
      ? "Zara couldn't finish this routine. Try running it again from Settings → Routines."
      : outcome.reply.slice(0, 280) + (outcome.reply.length > 280 ? "…" : "");
    const signal = await signals.create({
      userId,
      type: "user_action_required",
      sourceType: "routine_run",
      sourceId: runId,
      title,
      summary: message,
      dueAt: null,
      importanceHints: { routineId: routine.id },
    });
    await interventions.create({
      userId,
      signalId: signal.id,
      priority: needsApproval ? "high" : "medium",
      title,
      message,
      reason: `Routine: ${routine.title}`,
      actionType: outcome.conversationId ? "open_chat" : "none",
      actionPayload: outcome.conversationId ? { conversationId: outcome.conversationId } : null,
    });
  }

  async function runRoutine(routine: Routine): Promise<void> {
    if (running.has(routine.id)) return;
    running.add(routine.id);
    const run = await prisma.routineRun.create({ data: { routineId: routine.id } });
    try {
      const outcome = await runner(routine.userId, { title: routine.title, instruction: routine.instruction }).catch(() => ({
        conversationId: null,
        reply: "",
        cards: 0,
        failed: true,
      }));
      const status = outcome.failed ? "failed" : outcome.cards > 0 ? "needs_approval" : "ok";
      await prisma.routineRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status, conversationId: outcome.conversationId, summary: outcome.reply.slice(0, 2000) },
      });
      await prisma.routine.update({ where: { id: routine.id }, data: { lastStatus: status } });
      await activity.record(routine.userId, {
        kind: "routine_run",
        summary: `Ran the routine "${routine.title}"${status === "needs_approval" ? ` — ${outcome.cards} card(s) need your approval` : status === "failed" ? " — it didn't finish" : ""}`,
      });
      await deliver(routine.userId, routine, run.id, outcome);
    } finally {
      running.delete(routine.id);
    }
  }

  return {
    /** Plain words → a draft, without saving (Settings shows it before "Create"). */
    understand,

    async create(userId: string, text: string, now: Date = new Date(), options: { provider?: string | null } = {}): Promise<RoutineDto> {
      const understood = await understand(text, now);
      if (!understood.ok) throw validationError(understood.message);
      const { draft } = understood;
      const nextRunAt = nextRunAfter(draft.schedule, now);
      if (!nextRunAt) throw validationError("That time has already passed.");
      const row = await prisma.routine.create({
        data: {
          userId,
          title: draft.title,
          instruction: draft.instruction,
          schedule: JSON.stringify(draft.schedule),
          takesAction: draft.takesAction,
          nextRunAt,
        },
      });
      await activity.record(userId, {
        kind: "routine_created",
        summary: `Created the routine "${draft.title}" (${describeSchedule(draft.schedule)})`,
        provider: options.provider ?? null,
        undo: { routineId: row.id },
      });
      return toDto(row);
    },

    async list(userId: string): Promise<RoutineDto[]> {
      const rows = await prisma.routine.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
      return rows.map(toDto);
    },

    async update(
      userId: string,
      id: string,
      patch: { enabled?: boolean | undefined; title?: string | undefined; instruction?: string | undefined; when?: string | undefined },
      now: Date = new Date(),
    ): Promise<RoutineDto> {
      const row = await find(userId, id);
      let schedule = routineScheduleSchema.parse(JSON.parse(row.schedule));
      if (patch.when) {
        const understood = await understand(`${patch.when}: ${row.instruction}`, now);
        if (!understood.ok) throw validationError(understood.message);
        schedule = understood.draft.schedule;
      }
      const enabled = patch.enabled ?? row.enabled;
      const nextRunAt = enabled ? nextRunAfter(schedule, now) : row.nextRunAt;
      const updated = await prisma.routine.update({
        where: { id },
        data: {
          enabled,
          schedule: JSON.stringify(schedule),
          nextRunAt,
          ...(patch.title?.trim() ? { title: patch.title.trim().slice(0, 80) } : {}),
          ...(patch.instruction?.trim() ? { instruction: patch.instruction.trim().slice(0, 1000) } : {}),
        },
      });
      return toDto(updated);
    },

    async remove(userId: string, id: string): Promise<void> {
      const row = await find(userId, id);
      await prisma.routine.delete({ where: { id } });
      await activity.record(userId, {
        kind: "routine_deleted",
        summary: `Deleted the routine "${row.title}"`,
        undo: { title: row.title, instruction: row.instruction, schedule: row.schedule, takesAction: row.takesAction },
      });
    },

    /** "Run now" from Settings — in the background. */
    async runNow(userId: string, id: string): Promise<{ started: boolean }> {
      const row = await find(userId, id);
      if (running.has(id)) return { started: false };
      void runRoutine(row);
      return { started: true };
    },

    /**
     * Claims every due routine (moving its next run forward first, so it
     * can't start twice) and runs them in the background. A PC that was
     * off catches up with one run, not one per missed slot.
     */
    async runDue(now: Date = new Date(), options: { wait?: boolean } = {}): Promise<number> {
      const due = await prisma.routine.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });
      const claimed: Routine[] = [];
      for (const routine of due) {
        const schedule = routineScheduleSchema.parse(JSON.parse(routine.schedule));
        const next = nextRunAfter(schedule, now);
        const result = await prisma.routine.updateMany({
          where: { id: routine.id, nextRunAt: routine.nextRunAt },
          data: { nextRunAt: next, lastRunAt: now, ...(next ? {} : { enabled: false }) },
        });
        if (result.count === 1) claimed.push(routine);
      }
      const runs = claimed.map((routine) => runRoutine(routine).catch(() => undefined));
      if (options.wait) await Promise.all(runs);
      return claimed.length;
    },
  };
}

export type RoutinesService = ReturnType<typeof createRoutinesService>;

let shared: RoutinesService | null = null;
export function getRoutinesService(): RoutinesService {
  shared ??= createRoutinesService();
  return shared;
}

