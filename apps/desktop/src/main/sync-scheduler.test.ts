import { describe, expect, it, vi } from "vitest";
import { createSyncScheduler, type SchedulerApiClient } from "./sync-scheduler";

function fakeTimers() {
  const callbacks = new Map<number, () => void>();
  let nextId = 1;
  const setIntervalFn = vi.fn((fn: () => void) => {
    const id = nextId++;
    callbacks.set(id, fn);
    return id as unknown as ReturnType<typeof setInterval>;
  });
  const clearIntervalFn = vi.fn((id: ReturnType<typeof setInterval>) => {
    callbacks.delete(id as unknown as number);
  });
  return {
    setIntervalFn: setIntervalFn as unknown as typeof setInterval,
    clearIntervalFn: clearIntervalFn as unknown as typeof clearInterval,
    fire: async (id = 1) => {
      const cb = callbacks.get(id);
      if (!cb) throw new Error(`no callback registered for id ${id}`);
      cb();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("createSyncScheduler", () => {
  it("skips the tick entirely when paused — doesn't even call googleStatus", async () => {
    const api: SchedulerApiClient = {
      googleStatus: vi.fn().mockResolvedValue({ connected: true }),
      checkNow: vi.fn().mockResolvedValue({}),
      checkDue: vi.fn().mockResolvedValue({}),
    };
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      api,
      intervalMs: 5 * 60_000,
      isPaused: () => true,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    scheduler.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.googleStatus).not.toHaveBeenCalled();
    expect(api.checkNow).not.toHaveBeenCalled();
  });

  it("resumes normal ticking once isPaused starts returning false", async () => {
    let paused = true;
    const api: SchedulerApiClient = {
      googleStatus: vi.fn().mockResolvedValue({ connected: true }),
      checkNow: vi.fn().mockResolvedValue({}),
      checkDue: vi.fn().mockResolvedValue({}),
    };
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      api,
      intervalMs: 5 * 60_000,
      isPaused: () => paused,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    scheduler.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.checkNow).not.toHaveBeenCalled();

    paused = false;
    await timers.fire();
    expect(api.checkNow).toHaveBeenCalledTimes(1);
  });

  it("skips checkNow when Google isn't connected, but still checks on every tick", async () => {
    const api: SchedulerApiClient = {
      googleStatus: vi.fn().mockResolvedValue({ connected: false }),
      checkNow: vi.fn(),
      checkDue: vi.fn().mockResolvedValue({}),
    };
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      api,
      intervalMs: 5 * 60_000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    scheduler.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.googleStatus).toHaveBeenCalledTimes(1);
    expect(api.checkNow).not.toHaveBeenCalled();

    await timers.fire();
    expect(api.googleStatus).toHaveBeenCalledTimes(2);
    expect(api.checkNow).not.toHaveBeenCalled();
  });

  it("runs checkNow once Google is connected", async () => {
    const api: SchedulerApiClient = {
      googleStatus: vi.fn().mockResolvedValue({ connected: true }),
      checkNow: vi.fn().mockResolvedValue({ results: [] }),
      checkDue: vi.fn().mockResolvedValue({}),
    };
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      api,
      intervalMs: 5 * 60_000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    scheduler.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.checkNow).toHaveBeenCalledTimes(1);
  });

  it("runs an immediate tick on start, not just after the first interval", async () => {
    const api: SchedulerApiClient = {
      googleStatus: vi.fn().mockResolvedValue({ connected: true }),
      checkNow: vi.fn().mockResolvedValue({}),
      checkDue: vi.fn().mockResolvedValue({}),
    };
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      api,
      intervalMs: 5 * 60_000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    scheduler.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.googleStatus).toHaveBeenCalledTimes(1);
  });

  it("never overlaps two runs — a slow tick skips a concurrent one", async () => {
    let resolveStatus: (v: unknown) => void = () => {};
    const api: SchedulerApiClient = {
      googleStatus: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveStatus = resolve;
          }),
      ),
      checkNow: vi.fn().mockResolvedValue({}),
      checkDue: vi.fn().mockResolvedValue({}),
    };
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      api,
      intervalMs: 5 * 60_000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    scheduler.start();
    await Promise.resolve();
    // First run is still in-flight (googleStatus unresolved); firing the
    // interval callback again must not start a second overlapping run.
    await timers.fire();
    expect(api.googleStatus).toHaveBeenCalledTimes(1);

    resolveStatus({ connected: false });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("catches a failure from either API call without throwing", async () => {
    const api: SchedulerApiClient = {
      googleStatus: vi.fn().mockRejectedValue(new Error("network down")),
      checkNow: vi.fn(),
      checkDue: vi.fn().mockResolvedValue({}),
    };
    const logger = { error: vi.fn() };
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      api,
      intervalMs: 5 * 60_000,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    scheduler.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith("Scheduled sync failed", expect.any(Error));
  });

  it("start() is idempotent — a second call doesn't register a second interval", () => {
    const api: SchedulerApiClient = {
      googleStatus: vi.fn().mockResolvedValue({ connected: false }),
      checkNow: vi.fn(),
      checkDue: vi.fn().mockResolvedValue({}),
    };
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      api,
      intervalMs: 5 * 60_000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    scheduler.start();
    scheduler.start();

    // One full-sync interval + one delivery interval, not four.
    expect(timers.setIntervalFn).toHaveBeenCalledTimes(2);
  });

  it("stop() clears the interval and stop() before start() is a no-op", () => {
    const api: SchedulerApiClient = {
      googleStatus: vi.fn().mockResolvedValue({ connected: false }),
      checkNow: vi.fn(),
      checkDue: vi.fn().mockResolvedValue({}),
    };
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      api,
      intervalMs: 5 * 60_000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    expect(() => scheduler.stop()).not.toThrow();

    scheduler.start();
    scheduler.stop();

    expect(timers.clearIntervalFn).toHaveBeenCalledTimes(2);
  });

  describe("delivery tick (ADR-005)", () => {
    function makeApi(overrides: Partial<SchedulerApiClient> = {}): SchedulerApiClient {
      return {
        googleStatus: vi.fn().mockResolvedValue({ connected: false }),
        checkNow: vi.fn().mockResolvedValue({}),
        checkDue: vi.fn().mockResolvedValue({}),
        ...overrides,
      };
    }

    it("registers a 15-second delivery interval by default", () => {
      const timers = fakeTimers();
      createSyncScheduler({
        api: makeApi(),
        intervalMs: 15 * 60_000,
        setIntervalFn: timers.setIntervalFn,
        clearIntervalFn: timers.clearIntervalFn,
      }).start();

      expect(timers.setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 15 * 60_000);
      expect(timers.setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 15_000);
    });

    it("calls onTickComplete after a delivery check and after a full sync, not after a failure", async () => {
      const onTickComplete = vi.fn();
      const api = makeApi({ googleStatus: vi.fn().mockResolvedValue({ connected: true }) });
      const timers = fakeTimers();
      createSyncScheduler({
        api,
        intervalMs: 15 * 60_000,
        onTickComplete,
        setIntervalFn: timers.setIntervalFn,
        clearIntervalFn: timers.clearIntervalFn,
      }).start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onTickComplete).toHaveBeenCalledTimes(1); // startup full sync

      await timers.fire(2);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onTickComplete).toHaveBeenCalledTimes(2); // delivery check

      (api.checkDue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db locked"));
      await timers.fire(2);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onTickComplete).toHaveBeenCalledTimes(2);
    });

    it("delivers due items even when Google isn't connected, without a full sync", async () => {
      const api = makeApi();
      const timers = fakeTimers();
      createSyncScheduler({
        api,
        intervalMs: 15 * 60_000,
        setIntervalFn: timers.setIntervalFn,
        clearIntervalFn: timers.clearIntervalFn,
      }).start();
      await Promise.resolve();
      await Promise.resolve();

      await timers.fire(2);

      expect(api.checkDue).toHaveBeenCalledTimes(1);
      expect(api.checkNow).not.toHaveBeenCalled();
    });

    it("is silenced while paused", async () => {
      const api = makeApi();
      const timers = fakeTimers();
      createSyncScheduler({
        api,
        intervalMs: 15 * 60_000,
        isPaused: () => true,
        setIntervalFn: timers.setIntervalFn,
        clearIntervalFn: timers.clearIntervalFn,
      }).start();

      await timers.fire(2);

      expect(api.checkDue).not.toHaveBeenCalled();
    });

    it("never overlaps a full sync still in progress", async () => {
      let finishSync: () => void = () => {};
      const api = makeApi({
        googleStatus: vi.fn().mockResolvedValue({ connected: true }),
        checkNow: vi.fn(
          () =>
            new Promise((resolve) => {
              finishSync = () => resolve({});
            }),
        ),
      });
      const timers = fakeTimers();
      createSyncScheduler({
        api,
        intervalMs: 15 * 60_000,
        setIntervalFn: timers.setIntervalFn,
        clearIntervalFn: timers.clearIntervalFn,
      }).start();
      await Promise.resolve();
      await Promise.resolve();
      expect(api.checkNow).toHaveBeenCalledTimes(1);

      await timers.fire(2);
      expect(api.checkDue).not.toHaveBeenCalled();

      finishSync();
      await Promise.resolve();
      await Promise.resolve();
      await timers.fire(2);
      expect(api.checkDue).toHaveBeenCalledTimes(1);
    });

    it("logs a failed delivery check without throwing", async () => {
      const error = vi.fn();
      const api = makeApi({ checkDue: vi.fn().mockRejectedValue(new Error("db locked")) });
      const timers = fakeTimers();
      createSyncScheduler({
        api,
        intervalMs: 15 * 60_000,
        logger: { error },
        setIntervalFn: timers.setIntervalFn,
        clearIntervalFn: timers.clearIntervalFn,
      }).start();
      // Let the startup sync tick finish so the shared guard is free.
      await new Promise((resolve) => setTimeout(resolve, 0));

      await timers.fire(2);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(error).toHaveBeenCalledWith("Delivery check failed", expect.any(Error));
    });
  });
});
