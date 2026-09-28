import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatLocalNow,
  resolveReminderTiming,
  type ReminderIntent,
} from "./reminder-timing.js";

// Pin the machine timezone to IST (UTC+05:30, no DST) — the timezone the
// original "3:40 pm became 9:10 pm" bug was found in.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Asia/Kolkata";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

// Friday 25 Sep 2026, 15:40 IST.
const NOW = new Date("2026-09-25T10:10:00.000Z");

function intent(overrides: Partial<ReminderIntent>): ReminderIntent {
  return {
    kind: "ping",
    timeType: "clock",
    relativeMinutes: null,
    date: null,
    time: null,
    leadMinutes: null,
    ...overrides,
  };
}

function expectTiming(result: ReturnType<typeof resolveReminderTiming>, dueIso: string, remindIso: string) {
  expect(result).toEqual({ ok: true, dueAt: new Date(dueIso), remindAt: new Date(remindIso) });
}

describe("resolveReminderTiming — the user's rules (ADR-005)", () => {
  it('"remind me at 4pm" fires at 4:00 PM local exactly', () => {
    const result = resolveReminderTiming(intent({ kind: "ping", time: "16:00" }), NOW);
    // 16:00 IST = 10:30 UTC.
    expectTiming(result, "2026-09-25T10:30:00.000Z", "2026-09-25T10:30:00.000Z");
  });

  it('"remind me in 10 minutes" fires exactly 10 minutes from now', () => {
    const result = resolveReminderTiming(
      intent({ kind: "ping", timeType: "relative", relativeMinutes: 10 }),
      NOW,
    );
    expectTiming(result, "2026-09-25T10:20:00.000Z", "2026-09-25T10:20:00.000Z");
  });

  it('"there is a meeting at 5pm" alerts at 4:50 PM', () => {
    const result = resolveReminderTiming(intent({ kind: "event", time: "17:00" }), NOW);
    // 17:00 IST = 11:30 UTC; alert 10 minutes earlier.
    expectTiming(result, "2026-09-25T11:30:00.000Z", "2026-09-25T11:20:00.000Z");
  });

  it('"I have a meeting in 30 minutes" alerts in 20 minutes', () => {
    const result = resolveReminderTiming(
      intent({ kind: "event", timeType: "relative", relativeMinutes: 30 }),
      NOW,
    );
    expectTiming(result, "2026-09-25T10:40:00.000Z", "2026-09-25T10:30:00.000Z");
  });

  it("honours an explicit lead time", () => {
    const result = resolveReminderTiming(
      intent({ kind: "event", time: "17:00", leadMinutes: 15 }),
      NOW,
    );
    expectTiming(result, "2026-09-25T11:30:00.000Z", "2026-09-25T11:15:00.000Z");
  });
});

describe("resolveReminderTiming — clock times", () => {
  it("a bare time that already passed today means tomorrow", () => {
    const result = resolveReminderTiming(intent({ time: "09:00" }), NOW);
    // 09:00 IST on 26 Sep = 03:30 UTC.
    expectTiming(result, "2026-09-26T03:30:00.000Z", "2026-09-26T03:30:00.000Z");
  });

  it("the current minute itself counts as passed (never fires instantly by accident)", () => {
    const result = resolveReminderTiming(intent({ time: "15:40" }), NOW);
    expectTiming(result, "2026-09-26T10:10:00.000Z", "2026-09-26T10:10:00.000Z");
  });

  it("uses an explicit date in local time", () => {
    const result = resolveReminderTiming(intent({ date: "2026-09-26", time: "17:00" }), NOW);
    expectTiming(result, "2026-09-26T11:30:00.000Z", "2026-09-26T11:30:00.000Z");
  });

  it("defaults to 09:00 when only a date was given", () => {
    const result = resolveReminderTiming(intent({ date: "2026-09-26" }), NOW);
    expectTiming(result, "2026-09-26T03:30:00.000Z", "2026-09-26T03:30:00.000Z");
  });

  it("treats today's date like a bare time, so a passed time rolls to tomorrow", () => {
    const result = resolveReminderTiming(intent({ date: "2026-09-25", time: "15:00" }), NOW);
    expectTiming(result, "2026-09-26T09:30:00.000Z", "2026-09-26T09:30:00.000Z");
  });

  it("rejects an explicit earlier date that already passed", () => {
    expect(resolveReminderTiming(intent({ date: "2026-09-24", time: "09:00" }), NOW)).toEqual({
      ok: false,
      code: "time_in_past",
    });
  });

  it("rejects impossible dates and times", () => {
    expect(resolveReminderTiming(intent({ date: "2026-02-30", time: "10:00" }), NOW)).toEqual({
      ok: false,
      code: "invalid_time",
    });
    expect(resolveReminderTiming(intent({ time: "25:00" }), NOW)).toEqual({
      ok: false,
      code: "invalid_time",
    });
    expect(resolveReminderTiming(intent({ time: "4pm" }), NOW)).toEqual({
      ok: false,
      code: "invalid_time",
    });
  });

  it("asks for a time when a clock intent carries neither date nor time", () => {
    expect(resolveReminderTiming(intent({}), NOW)).toEqual({ ok: false, code: "missing_time" });
  });
});

describe("resolveReminderTiming — relative and missing times", () => {
  it("rejects zero, negative, missing and absurd durations", () => {
    for (const relativeMinutes of [0, -5, null, 10_000_000]) {
      expect(
        resolveReminderTiming(intent({ timeType: "relative", relativeMinutes }), NOW),
      ).toEqual({ ok: false, code: "invalid_time" });
    }
  });

  it('reports "none" as a missing time', () => {
    expect(resolveReminderTiming(intent({ timeType: "none" }), NOW)).toEqual({
      ok: false,
      code: "missing_time",
    });
  });
});

describe("resolveReminderTiming — alert never in the past", () => {
  it("an event sooner than its lead time alerts right away", () => {
    const result = resolveReminderTiming(
      intent({ kind: "event", timeType: "relative", relativeMinutes: 5 }),
      NOW,
    );
    expectTiming(result, "2026-09-25T10:15:00.000Z", NOW.toISOString());
  });

  it("clamps an absurd lead time to one day", () => {
    const result = resolveReminderTiming(
      intent({ kind: "event", date: "2026-09-28", time: "10:00", leadMinutes: 99_999 }),
      NOW,
    );
    // 28 Sep 10:00 IST = 04:30 UTC; minus 1440 minutes.
    expectTiming(result, "2026-09-28T04:30:00.000Z", "2026-09-27T04:30:00.000Z");
  });
});

describe("formatLocalNow", () => {
  it("renders local time with offset and weekday", () => {
    expect(formatLocalNow(NOW)).toBe("2026-09-25T15:40:00+05:30 (Friday)");
  });
});
