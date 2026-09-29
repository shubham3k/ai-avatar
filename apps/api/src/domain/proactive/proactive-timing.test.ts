import { describe, expect, it } from "vitest";
import { isBriefingDue, type BriefingScheduleSettings } from "./briefing-schedule.js";
import { atLocalClock } from "./local-time.js";
import { computePromiseReminder } from "./promise-timing.js";
import { resolvePromiseDate } from "./sent-mail-analysis.js";

const at = (date: string, clock: string) => atLocalClock(date, clock)!;
const defaults = { remindTime: "10:00", sameDayLeadHours: 2 };

describe("computePromiseReminder (ADR-006 §6)", () => {
  it("reminds the day before at 10:00", () => {
    // Tuesday 29 Sep, promise due Friday 2 Oct (no time → 17:00).
    const result = computePromiseReminder({ ...defaults, dueDate: "2026-10-02", dueTime: null, now: at("2026-09-29", "15:00") });
    expect(result).toEqual({ dueAt: at("2026-10-02", "17:00"), remindAt: at("2026-10-01", "10:00") });
  });

  it("reminds 2 hours before when it's due today", () => {
    const result = computePromiseReminder({ ...defaults, dueDate: "2026-09-29", dueTime: "16:00", now: at("2026-09-29", "09:00") });
    expect(result?.remindAt).toEqual(at("2026-09-29", "14:00"));
  });

  it("reminds right away when there's less time left than the lead", () => {
    const now = at("2026-09-29", "15:30");
    const result = computePromiseReminder({ ...defaults, dueDate: "2026-09-29", dueTime: "16:00", now });
    expect(result?.remindAt).toEqual(now);
  });

  it("falls back to 2 hours before when 'the day before at 10' has already passed", () => {
    const result = computePromiseReminder({ ...defaults, dueDate: "2026-09-30", dueTime: "12:00", now: at("2026-09-29", "18:00") });
    expect(result?.remindAt).toEqual(at("2026-09-30", "10:00"));
  });

  it("honours custom settings", () => {
    const result = computePromiseReminder({
      remindTime: "08:30",
      sameDayLeadHours: 4,
      dueDate: "2026-10-05",
      dueTime: "11:00",
      now: at("2026-09-29", "12:00"),
    });
    expect(result?.remindAt).toEqual(at("2026-10-04", "08:30"));
  });

  it("skips promises already past due and malformed dates", () => {
    expect(computePromiseReminder({ ...defaults, dueDate: "2026-09-28", dueTime: null, now: at("2026-09-29", "09:00") })).toBeNull();
    expect(computePromiseReminder({ ...defaults, dueDate: "2026-02-31", dueTime: null, now: at("2026-01-01", "09:00") })).toBeNull();
    expect(computePromiseReminder({ ...defaults, dueDate: "Friday", dueTime: null, now: at("2026-09-29", "09:00") })).toBeNull();
  });
});

const settings: BriefingScheduleSettings = {
  briefingEnabled: true,
  briefingWeekdaysOnly: false,
  wrapUpEnabled: true,
  wrapUpTime: "18:00",
  lastBriefingOn: null,
  lastWrapUpOn: null,
};

describe("isBriefingDue", () => {
  it("morning: from 05:00 until the wrap-up time, once a day", () => {
    expect(isBriefingDue("morning", settings, at("2026-09-29", "04:59"))).toBe(false);
    expect(isBriefingDue("morning", settings, at("2026-09-29", "08:15"))).toBe(true);
    expect(isBriefingDue("morning", settings, at("2026-09-29", "18:30"))).toBe(false);
    expect(isBriefingDue("morning", { ...settings, lastBriefingOn: "2026-09-29" }, at("2026-09-29", "09:00"))).toBe(false);
    expect(isBriefingDue("morning", { ...settings, lastBriefingOn: "2026-09-28" }, at("2026-09-29", "09:00"))).toBe(true);
  });

  it("morning: weekdays-only skips Saturday and Sunday", () => {
    const weekdays = { ...settings, briefingWeekdaysOnly: true };
    expect(isBriefingDue("morning", weekdays, at("2026-10-03", "09:00"))).toBe(false); // Saturday
    expect(isBriefingDue("morning", weekdays, at("2026-10-05", "09:00"))).toBe(true); // Monday
  });

  it("wrap-up: from the configured time until midnight, once a day", () => {
    expect(isBriefingDue("wrap_up", settings, at("2026-09-29", "17:59"))).toBe(false);
    expect(isBriefingDue("wrap_up", settings, at("2026-09-29", "18:00"))).toBe(true);
    expect(isBriefingDue("wrap_up", { ...settings, wrapUpTime: "19:30" }, at("2026-09-29", "19:00"))).toBe(false);
    expect(isBriefingDue("wrap_up", { ...settings, lastWrapUpOn: "2026-09-29" }, at("2026-09-29", "21:00"))).toBe(false);
  });

  it("never when switched off", () => {
    expect(isBriefingDue("morning", { ...settings, briefingEnabled: false }, at("2026-09-29", "09:00"))).toBe(false);
    expect(isBriefingDue("wrap_up", { ...settings, wrapUpEnabled: false }, at("2026-09-29", "19:00"))).toBe(false);
  });
});

describe("resolvePromiseDate — code does the calendar maths", () => {
  const monday = at("2026-09-28", "15:00");
  const friday = at("2026-10-02", "09:00");
  const saturday = at("2026-10-03", "09:00");
  const p = (when: "today" | "tomorrow" | "weekday" | "end_of_week" | "next_week" | "date", extra: object = {}) => ({
    when,
    weekday: null,
    date: null,
    ...extra,
  });

  it("resolves relative to when the email was sent", () => {
    expect(resolvePromiseDate(p("today"), monday)).toBe("2026-09-28");
    expect(resolvePromiseDate(p("tomorrow"), monday)).toBe("2026-09-29");
    expect(resolvePromiseDate(p("weekday", { weekday: "friday" }), monday)).toBe("2026-10-02");
    expect(resolvePromiseDate(p("weekday", { weekday: "monday" }), monday)).toBe("2026-10-05");
    expect(resolvePromiseDate(p("weekday", { weekday: "friday" }), friday)).toBe("2026-10-09");
    expect(resolvePromiseDate(p("end_of_week"), monday)).toBe("2026-10-02");
    expect(resolvePromiseDate(p("end_of_week"), friday)).toBe("2026-10-02");
    expect(resolvePromiseDate(p("end_of_week"), saturday)).toBe("2026-10-09");
    expect(resolvePromiseDate(p("next_week"), monday)).toBe("2026-10-05");
    expect(resolvePromiseDate(p("date", { date: "2026-10-15" }), monday)).toBe("2026-10-15");
  });

  it("gives up on an incomplete answer", () => {
    expect(resolvePromiseDate(p("weekday"), monday)).toBeNull();
    expect(resolvePromiseDate(p("date"), monday)).toBeNull();
  });
});
