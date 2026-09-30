import { z } from "zod";
import type { ZaraTool } from "./zara-tools.js";

/** ADR-006 M9 — routines from chat: create in plain words, list, pause/resume/delete. */

function tool<Schema extends z.ZodTypeAny>(definition: ZaraTool<Schema>): ZaraTool<Schema> {
  return definition;
}

const createRoutine = tool({
  tier: "local_write",
  status: "Setting up the routine…",
  definition: {
    name: "create_routine",
    description:
      "Set up a recurring task from the user's own words, e.g. \"every Monday at 9, summarize unanswered emails\" or \"every weekday at 6pm, list tomorrow's meetings\". Pass their request as they said it. Routines that only read and report run by themselves; anything that would send or change something prepares an approval card every run.",
    parameters: {
      type: "object",
      properties: { request: { type: "string", description: "The user's request, in their words." } },
      required: ["request"],
      additionalProperties: false,
    },
  },
  schema: z.object({ request: z.string().trim().min(5).max(500) }),
  async run(args, { routines, userId, now, incognito }) {
    if (incognito) return { error: "This is an incognito chat — nothing is saved." };
    if (!routines) return { error: "Routines aren't available right now." };
    try {
      const routine = await routines.create(userId, args.request, now);
      return {
        created: routine.title,
        when: routine.scheduleText,
        firstRun: routine.nextRunAt,
        asksEveryRun: routine.takesAction,
        note: "Tell the user in a few words; they can pause, edit or delete it in Settings → Routines.",
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't set that up." };
    }
  },
});

const listRoutines = tool({
  tier: "read",
  status: "Checking your routines…",
  definition: {
    name: "list_routines",
    description: "The user's routines: what each does, when it runs, whether it's paused, and how the last run went.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  schema: z.object({}).strict(),
  async run(_args, { routines, userId }) {
    if (!routines) return { error: "Routines aren't available right now." };
    const list = await routines.list(userId);
    return {
      routines: list.map((routine) => ({
        id: routine.id,
        title: routine.title,
        does: routine.instruction,
        when: routine.scheduleText,
        paused: !routine.enabled,
        nextRun: routine.nextRunAt,
        lastRun: routine.lastRunAt ? { at: routine.lastRunAt, status: routine.lastStatus } : null,
      })),
    };
  },
});

const changeRoutine = tool({
  tier: "local_write",
  status: "Updating the routine…",
  definition: {
    name: "change_routine",
    description: "Pause, resume, or delete one of the user's routines (id from list_routines), or give it a new schedule in the user's words.",
    parameters: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        action: { type: "string", enum: ["pause", "resume", "delete", "reschedule"] },
        when: { type: "string", description: "For reschedule: the new timing in the user's words, e.g. \"every Friday at 5pm\"." },
      },
      required: ["routineId", "action"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    routineId: z.string().min(1).max(100),
    action: z.enum(["pause", "resume", "delete", "reschedule"]),
    when: z.string().trim().max(200).optional(),
  }),
  async run(args, { routines, userId, now }) {
    if (!routines) return { error: "Routines aren't available right now." };
    try {
      if (args.action === "delete") {
        await routines.remove(userId, args.routineId);
        return { deleted: true, note: "It can be restored from Settings → Activity (Undo)." };
      }
      if (args.action === "reschedule" && !args.when) return { error: "When should it run instead?" };
      const updated = await routines.update(
        userId,
        args.routineId,
        args.action === "reschedule" ? { when: args.when } : { enabled: args.action === "resume" },
        now,
      );
      return { title: updated.title, when: updated.scheduleText, paused: !updated.enabled, nextRun: updated.nextRunAt };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't change that routine." };
    }
  },
});

export const ROUTINE_TOOLS: readonly ZaraTool[] = [createRoutine, listRoutines, changeRoutine];
/** Not offered while a routine itself is running — a routine can't create routines or approve anything. */
export const NOT_IN_ROUTINE_RUNS = new Set(["create_routine", "change_routine", "approve_calendar_in_chat"]);
