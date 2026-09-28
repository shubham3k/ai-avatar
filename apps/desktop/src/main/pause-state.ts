export interface PauseState {
  /** Suppresses automatic sync for the given duration; resuming an already-paused state just extends/replaces it. */
  pause(durationMs: number): void;
  /** Clears an active pause immediately; a no-op if not paused. */
  resume(): void;
  isPaused(): boolean;
  /** Epoch ms the current pause ends, or null if not paused. */
  pausedUntil(): number | null;
}

/**
 * "Pause notifications" (tray menu) — deliberately in-memory only, not
 * persisted: it resets to "not paused" on every app restart, the same as
 * the sync scheduler itself. A stale pause silently surviving a restart
 * (e.g. the user paused for 4 hours, quit and relaunched an hour later)
 * would be a much worse failure mode than just needing to re-pause.
 */
export function createPauseState(options?: {
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): PauseState {
  const now = options?.now ?? Date.now;
  const setTimeoutFn = options?.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options?.clearTimeoutFn ?? clearTimeout;

  let until: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  return {
    pause(durationMs) {
      clearTimer();
      until = now() + durationMs;
      timer = setTimeoutFn(() => {
        until = null;
        timer = null;
      }, durationMs);
    },
    resume() {
      clearTimer();
      until = null;
    },
    isPaused() {
      return until !== null && until > now();
    },
    pausedUntil() {
      return until;
    },
  };
}
