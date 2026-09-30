import { z } from "zod";

/**
 * ADR-006 §10 routines: when a routine runs. The model turns the user's
 * words into this shape; code (not the model) works out the next run.
 */
export const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export const routineScheduleSchema = z.discriminatedUnion("frequency", [
  z.object({ frequency: z.literal("daily"), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({ frequency: z.literal("weekdays"), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({
    frequency: z.literal("weekly"),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
  z.object({
    frequency: z.literal("monthly"),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    dayOfMonth: z.number().int().min(1).max(31),
  }),
  z.object({ frequency: z.literal("once"), at: z.string().refine((value) => !Number.isNaN(new Date(value).getTime())) }),
]);
export type RoutineSchedule = z.infer<typeof routineScheduleSchema>;

function atClock(day: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * The next run strictly after `after` (local time), or null when a one-off
 * routine is already past. Monthly on the 31st runs on the last day of
 * shorter months.
 */
export function nextRunAfter(schedule: RoutineSchedule, after: Date): Date | null {
  if (schedule.frequency === "once") {
    const at = new Date(schedule.at);
    return at.getTime() > after.getTime() ? at : null;
  }
  if (schedule.frequency === "monthly") {
    for (let offset = 0; offset < 3; offset += 1) {
      const month = new Date(after.getFullYear(), after.getMonth() + offset, 1);
      const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const candidate = atClock(new Date(month.getFullYear(), month.getMonth(), Math.min(schedule.dayOfMonth, lastDay)), schedule.time);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
    return null;
  }
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = addDays(after, offset);
    const weekday = day.getDay();
    const allowed =
      schedule.frequency === "daily" ||
      (schedule.frequency === "weekdays" && weekday >= 1 && weekday <= 5) ||
      (schedule.frequency === "weekly" && schedule.weekdays.includes(weekday));
    if (!allowed) continue;
    const candidate = atClock(day, schedule.time);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}

function clock12(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours! >= 12 ? "PM" : "AM";
  const hour = hours! % 12 === 0 ? 12 : hours! % 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** "Every Monday and Thursday at 9:00 AM" */
export function describeSchedule(schedule: RoutineSchedule): string {
  switch (schedule.frequency) {
    case "daily":
      return `Every day at ${clock12(schedule.time)}`;
    case "weekdays":
      return `Every weekday at ${clock12(schedule.time)}`;
    case "weekly": {
      const days = [...schedule.weekdays].sort().map((day) => WEEKDAY_NAMES[day]!.charAt(0).toUpperCase() + WEEKDAY_NAMES[day]!.slice(1));
      const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}` : days[0];
      return `Every ${list} at ${clock12(schedule.time)}`;
    }
    case "monthly":
      return `Monthly on the ${ordinal(schedule.dayOfMonth)} at ${clock12(schedule.time)}`;
    case "once":
      return `Once, ${new Date(schedule.at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
  }
}
