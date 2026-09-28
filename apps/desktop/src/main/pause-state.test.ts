import { describe, expect, it, vi } from "vitest";
import { createPauseState } from "./pause-state";

function fakeClock(startMs: number) {
  let current = startMs;
  const callbacks = new Map<number, { fn: () => void; at: number }>();
  let nextId = 1;
  const setTimeoutFn = vi.fn((fn: () => void, ms: number) => {
    const id = nextId++;
    callbacks.set(id, { fn, at: current + ms });
    return id as unknown as ReturnType<typeof setTimeout>;
  });
  const clearTimeoutFn = vi.fn((id: ReturnType<typeof setTimeout>) => {
    callbacks.delete(id as unknown as number);
  });
  return {
    now: () => current,
    setTimeoutFn: setTimeoutFn as unknown as typeof setTimeout,
    clearTimeoutFn: clearTimeoutFn as unknown as typeof clearTimeout,
    advance(ms: number) {
      current += ms;
      for (const [id, entry] of [...callbacks.entries()]) {
        if (entry.at <= current) {
          callbacks.delete(id);
          entry.fn();
        }
      }
    },
  };
}

describe("createPauseState", () => {
  it("starts not paused", () => {
    const state = createPauseState();
    expect(state.isPaused()).toBe(false);
    expect(state.pausedUntil()).toBeNull();
  });

  it("is paused immediately after pause() and reports the correct pausedUntil", () => {
    const clock = fakeClock(1000);
    const state = createPauseState(clock);

    state.pause(60_000);

    expect(state.isPaused()).toBe(true);
    expect(state.pausedUntil()).toBe(1000 + 60_000);
  });

  it("automatically un-pauses once the duration elapses", () => {
    const clock = fakeClock(0);
    const state = createPauseState(clock);

    state.pause(60_000);
    clock.advance(60_000);

    expect(state.isPaused()).toBe(false);
    expect(state.pausedUntil()).toBeNull();
  });

  it("resume() clears an active pause immediately", () => {
    const clock = fakeClock(0);
    const state = createPauseState(clock);

    state.pause(60_000);
    state.resume();

    expect(state.isPaused()).toBe(false);
    clock.advance(60_000);
    expect(state.isPaused()).toBe(false);
  });

  it("resume() before any pause is a harmless no-op", () => {
    const state = createPauseState();
    expect(() => state.resume()).not.toThrow();
    expect(state.isPaused()).toBe(false);
  });

  it("pausing again while already paused replaces the previous pause, not stacks it", () => {
    const clock = fakeClock(0);
    const state = createPauseState(clock);

    state.pause(60_000);
    clock.advance(30_000);
    state.pause(60_000);

    expect(state.pausedUntil()).toBe(30_000 + 60_000);
    // The original pause's timer would have fired at t=60_000 and cleared
    // `until` had it not been cancelled by the second pause() call —
    // confirm it's still paused there, proving the old timer was replaced,
    // not left running alongside the new one.
    clock.advance(30_000);
    expect(state.isPaused()).toBe(true);
    // Only the replacement's own expiry (t=90_000) actually clears it.
    clock.advance(29_999);
    expect(state.isPaused()).toBe(true);
    clock.advance(1);
    expect(state.isPaused()).toBe(false);
  });
});
