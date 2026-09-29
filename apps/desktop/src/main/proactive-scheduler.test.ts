import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consentKeyForPath, createFocusMonitor, FOCUS_SCRIPT, interpretFocusSample, NOT_BUSY } from "./focus-monitor";
import { computeHold, createProactiveScheduler, inQuietHours, parseBriefing } from "./proactive-scheduler";

const OWN = "C:\\Users\\me\\AppData\\Local\\Programs\\AI Executive Agent\\AI Executive Agent.exe";

describe("interpretFocusSample (M5)", () => {
  it("reads Windows' own busy / presentation states", () => {
    expect(interpretFocusSample({ state: 2, inUse: [] }, [])).toEqual({ busy: true, reason: "fullscreen" });
    expect(interpretFocusSample({ state: 3, inUse: [] }, [])).toEqual({ busy: true, reason: "fullscreen" });
    expect(interpretFocusSample({ state: 4, inUse: [] }, [])).toEqual({ busy: true, reason: "presentation" });
    expect(interpretFocusSample({ state: 5, inUse: [] }, [])).toEqual(NOT_BUSY);
  });

  it("treats another app using the mic or camera as a call — but not Zara's own mic", () => {
    expect(interpretFocusSample({ state: 5, inUse: ["C:#Program Files#Zoom#bin#Zoom.exe"] }, [])).toEqual({ busy: true, reason: "call" });
    expect(interpretFocusSample({ state: 5, inUse: [consentKeyForPath(OWN).toUpperCase()] }, [consentKeyForPath(OWN)])).toEqual(NOT_BUSY);
  });

  it("ignores garbage", () => {
    expect(interpretFocusSample(null, [])).toEqual(NOT_BUSY);
    expect(interpretFocusSample({ state: "x", inUse: "y" }, [])).toEqual(NOT_BUSY);
  });

  it("the helper script only reads: one API call and the consent registry", () => {
    expect(FOCUS_SCRIPT).toContain("SHQueryUserNotificationState");
    expect(FOCUS_SCRIPT).toContain("CapabilityAccessManager\\ConsentStore");
    expect(FOCUS_SCRIPT).not.toMatch(/Set-Item|Remove-Item|New-Item|Invoke-WebRequest/);
  });
});

describe("createFocusMonitor", () => {
  it("parses helper output lines and reports changes", () => {
    const stdout = new EventEmitter() as EventEmitter & { setEncoding: () => void };
    stdout.setEncoding = () => undefined;
    const child = Object.assign(new EventEmitter(), { stdout, kill: vi.fn() });
    const spawnFn = vi.fn(() => child) as never;
    const onChange = vi.fn();
    const monitor = createFocusMonitor({ ownExecutablePath: OWN, onChange, platform: "win32", spawnFn });

    stdout.emit("data", '{"state":5,"inUse":[]}\n{"state":4,');
    expect(onChange).not.toHaveBeenCalled();
    stdout.emit("data", '"inUse":[]}\n');
    expect(onChange).toHaveBeenCalledWith({ busy: true, reason: "presentation" });
    expect(monitor.current()).toEqual({ busy: true, reason: "presentation" });
    monitor.stop();
    expect(child.kill).toHaveBeenCalled();
  });

  it("does nothing off Windows", () => {
    const spawnFn = vi.fn();
    expect(createFocusMonitor({ ownExecutablePath: OWN, platform: "darwin", spawnFn: spawnFn as never }).current()).toEqual(NOT_BUSY);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

const at = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return new Date(2026, 8, 29, h, m);
};
const hold = { holdDuringFocus: true, quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00" };

describe("hold rules (M5)", () => {
  it("quiet hours can cross midnight", () => {
    expect(inQuietHours(hold, at("23:30"))).toBe(true);
    expect(inQuietHours(hold, at("06:59"))).toBe(true);
    expect(inQuietHours(hold, at("07:00"))).toBe(false);
    expect(inQuietHours({ quietHoursStart: "13:00", quietHoursEnd: "14:00" }, at("13:30"))).toBe(true);
    expect(inQuietHours({ quietHoursStart: "13:00", quietHoursEnd: "13:00" }, at("13:00"))).toBe(false);
  });

  it("holds during focus or quiet hours, per settings", () => {
    const call = { busy: true, reason: "call" as const };
    expect(computeHold(hold, call, at("10:00"))).toEqual({ holding: true, reason: "call" });
    expect(computeHold({ ...hold, holdDuringFocus: false }, call, at("10:00"))).toEqual({ holding: false, reason: null });
    expect(computeHold({ ...hold, quietHoursEnabled: true }, NOT_BUSY, at("23:00"))).toEqual({ holding: true, reason: "quiet_hours" });
    expect(computeHold(hold, NOT_BUSY, at("23:00"))).toEqual({ holding: false, reason: null });
    expect(computeHold(null, call, at("10:00"))).toEqual({ holding: false, reason: null });
  });
});

describe("parseBriefing", () => {
  it("accepts only a delivered, well-formed briefing", () => {
    const ok = { delivered: true, kind: "morning", conversationId: "c1", title: "t", text: "x", mode: "both" };
    expect(parseBriefing(ok)).toEqual({ kind: "morning", conversationId: "c1", title: "t", text: "x", mode: "both" });
    expect(parseBriefing({ delivered: false })).toBeNull();
    expect(parseBriefing({ ...ok, mode: "shout" })).toBeNull();
  });
});

describe("createProactiveScheduler (M5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const briefing = { delivered: true, kind: "morning", conversationId: "c1", title: "Morning briefing", text: "Hi", mode: "written" };

  function setup(overrides: { idle?: number; focusBusy?: boolean; paused?: boolean; settings?: object } = {}) {
    const api = {
      proactiveSettings: vi.fn().mockResolvedValue(overrides.settings ?? hold),
      deliverBriefing: vi.fn(async (kind: string) => (kind === "morning" ? briefing : { delivered: false })),
    };
    const onBriefing = vi.fn();
    const onHoldChange = vi.fn();
    const scheduler = createProactiveScheduler({
      api,
      focus: () => (overrides.focusBusy ? { busy: true, reason: "fullscreen" } : NOT_BUSY),
      idleSeconds: () => overrides.idle ?? 0,
      isPaused: () => overrides.paused ?? false,
      onHoldChange,
      onBriefing,
      now: () => at("09:00"),
    });
    return { api, onBriefing, onHoldChange, scheduler };
  }

  it("asks for a briefing while the user is at the PC and hands it over", async () => {
    const { api, onBriefing, scheduler } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.deliverBriefing).toHaveBeenCalledWith("morning");
    expect(onBriefing).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "c1" }));
    scheduler.stop();
  });

  it("waits while the user is away, busy, or has paused notifications", async () => {
    for (const overrides of [{ idle: 600 }, { focusBusy: true }, { paused: true }]) {
      const { api, scheduler } = setup(overrides);
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.deliverBriefing).not.toHaveBeenCalled();
      scheduler.stop();
    }
  });

  it("an unlock checks right away even though the PC was idle", async () => {
    const { api, scheduler } = setup({ idle: 3600 });
    scheduler.userReturned();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.deliverBriefing).toHaveBeenCalledWith("morning");
  });

  it("reports hold changes", async () => {
    const { onHoldChange, scheduler } = setup({ focusBusy: true });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onHoldChange).toHaveBeenCalledWith({ holding: true, reason: "fullscreen" });
    scheduler.stop();
  });
});
