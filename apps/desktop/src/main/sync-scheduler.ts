export interface SchedulerApiClient {
  googleStatus(): Promise<unknown>;
  checkNow(): Promise<unknown>;
  /** Local-only due check (reminders + already-synced calendar events) — see ApiClient.checkDue. */
  checkDue(): Promise<unknown>;
}

/**
 * How often the local delivery tick runs (ADR-005). Cheap — it only reads
 * the local SQLite database, never calls Google or Groq. Was 60s until the
 * user's retest (Sept 28, 2026): a reminder due at 13:03:34 could wait for
 * the 13:04:16 tick plus the renderer's 15s inbox poll — up to ~75s late.
 * 15s here, plus onTickComplete pushing an immediate refresh to the
 * renderer, keeps alerts within ~15s of their target time.
 */
export const DELIVERY_INTERVAL_MS = 15_000;

export interface SchedulerLogger {
  info?(message: string): void;
  error(message: string, err: unknown): void;
}

export interface SyncScheduler {
  start(): void;
  stop(): void;
}

function isGoogleConnected(status: unknown): boolean {
  return (
    typeof status === "object" &&
    status !== null &&
    "connected" in status &&
    (status as { connected: unknown }).connected === true
  );
}

/**
 * The continuous stand-in for the manual "Check now" button: on the same
 * interval, asks the API whether Google is actually connected (skipping
 * silently if not — e.g. onboarding isn't finished yet) and, if so, runs
 * the same sync -> detect-signals -> evaluate sequence checkNow() does.
 * Runs in the main process so it keeps working regardless of what screen
 * the renderer is showing; onTickComplete lets the caller tell the
 * renderer to refresh right away (its own 15s inbox poll is only the
 * fallback). A single in-flight run at a time; a slow or failed run never
 * crashes the app or blocks the next scheduled tick.
 *
 * Also runs a second, faster tick (deliveryIntervalMs, default 15s —
 * ADR-005) that only delivers what's already due locally: reminders and
 * upcoming meetings from the last sync. That one doesn't need Google to
 * be connected. Both ticks share one in-flight guard so they never
 * overlap, and both are silenced while paused.
 */
export function createSyncScheduler(options: {
  api: SchedulerApiClient;
  intervalMs: number;
  deliveryIntervalMs?: number;
  logger?: SchedulerLogger;
  /** "Pause notifications" (tray menu, see pause-state.ts) — when true, skips the tick entirely, without even checking Google's connection status. Manual "Check now" (button/tray) deliberately bypasses this — pausing only silences the automatic background checks. */
  isPaused?: () => boolean;
  /** Called after every successful tick of either kind — e.g. to push an immediate inbox refresh to the renderer instead of waiting for its own poll. */
  onTickComplete?: () => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): SyncScheduler {
  const {
    api,
    intervalMs,
    deliveryIntervalMs = DELIVERY_INTERVAL_MS,
    logger,
    isPaused,
    onTickComplete,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = options;

  let timer: ReturnType<typeof setInterval> | null = null;
  let deliveryTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  /** Shared in-flight guard: a tick of either kind is skipped while any other run is still going. */
  async function exclusive(run: () => Promise<void>): Promise<void> {
    if (running) return;
    running = true;
    try {
      if (isPaused?.()) return;
      await run();
    } finally {
      running = false;
    }
  }

  async function tick(): Promise<void> {
    await exclusive(async () => {
      try {
        const status = await api.googleStatus();
        if (!isGoogleConnected(status)) return;
        await api.checkNow();
        logger?.info?.("Scheduled sync completed");
        onTickComplete?.();
      } catch (err) {
        logger?.error("Scheduled sync failed", err);
      }
    });
  }

  async function deliveryTick(): Promise<void> {
    await exclusive(async () => {
      try {
        await api.checkDue();
        onTickComplete?.();
      } catch (err) {
        logger?.error("Delivery check failed", err);
      }
    });
  }

  return {
    start() {
      if (timer) return;
      void tick();
      timer = setIntervalFn(() => {
        void tick();
      }, intervalMs);
      deliveryTimer = setIntervalFn(() => {
        void deliveryTick();
      }, deliveryIntervalMs);
    },
    stop() {
      if (timer) {
        clearIntervalFn(timer);
        timer = null;
      }
      if (deliveryTimer) {
        clearIntervalFn(deliveryTimer);
        deliveryTimer = null;
      }
    },
  };
}
