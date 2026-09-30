import type { FocusState } from "./focus-monitor.js";

/**
 * ADR-006 M5 desktop side: whether pop-ups are held right now, and when to
 * ask the API for the morning briefing / wrap-up.
 */
export interface HoldSettings {
  holdDuringFocus: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export type HoldReason = "fullscreen" | "presentation" | "call" | "quiet_hours";

export interface HoldState {
  holding: boolean;
  reason: HoldReason | null;
}

export const NOT_HOLDING: HoldState = { holding: false, reason: null };

function clockMinutes(clock: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Quiet hours may cross midnight (22:00–07:00). Equal start and end means "never". */
export function inQuietHours(settings: Pick<HoldSettings, "quietHoursStart" | "quietHoursEnd">, now: Date): boolean {
  const start = clockMinutes(settings.quietHoursStart);
  const end = clockMinutes(settings.quietHoursEnd);
  if (start === null || end === null || start === end) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function computeHold(settings: HoldSettings | null, focus: FocusState, now: Date): HoldState {
  if (!settings) return NOT_HOLDING;
  if (settings.quietHoursEnabled && inQuietHours(settings, now)) return { holding: true, reason: "quiet_hours" };
  if (settings.holdDuringFocus && focus.busy && focus.reason) return { holding: true, reason: focus.reason };
  return NOT_HOLDING;
}

export function parseHoldSettings(raw: unknown): HoldSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.holdDuringFocus !== "boolean" ||
    typeof value.quietHoursEnabled !== "boolean" ||
    typeof value.quietHoursStart !== "string" ||
    typeof value.quietHoursEnd !== "string"
  ) {
    return null;
  }
  return {
    holdDuringFocus: value.holdDuringFocus,
    quietHoursEnabled: value.quietHoursEnabled,
    quietHoursStart: value.quietHoursStart,
    quietHoursEnd: value.quietHoursEnd,
  };
}

export interface BriefingPayload {
  kind: "morning" | "wrap_up";
  conversationId: string;
  title: string;
  text: string;
  mode: "written" | "spoken" | "both";
}

export function parseBriefing(raw: unknown): BriefingPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.delivered !== true) return null;
  if (
    (value.kind !== "morning" && value.kind !== "wrap_up") ||
    typeof value.conversationId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.text !== "string" ||
    (value.mode !== "written" && value.mode !== "spoken" && value.mode !== "both")
  ) {
    return null;
  }
  return {
    kind: value.kind,
    conversationId: value.conversationId,
    title: value.title,
    text: value.text,
    mode: value.mode,
  };
}

/** The user counts as "at the PC" if they touched the keyboard or mouse within this long. */
export const ACTIVE_IDLE_SECONDS = 120;
export const PROACTIVE_TICK_MS = 60_000;

export interface ProactiveSchedulerApi {
  proactiveSettings(): Promise<unknown>;
  deliverBriefing(kind: "morning" | "wrap_up"): Promise<unknown>;
}

export interface ProactiveScheduler {
  start(): void;
  stop(): void;
  /** Unlock / resume: check for a briefing right away. */
  userReturned(): void;
  hold(): HoldState;
}

/**
 * Every minute: refresh the hold state (focus + quiet hours) and push
 * changes; and, only while the user is actually at the PC and nothing is
 * held or paused, ask the API for the morning briefing or the wrap-up. The
 * API decides whether one is due and makes sure each is sent once a day.
 */
export function createProactiveScheduler(options: {
  api: ProactiveSchedulerApi;
  focus: () => FocusState;
  idleSeconds: () => number;
  isPaused: () => boolean;
  onHoldChange: (state: HoldState) => void;
  onBriefing: (briefing: BriefingPayload) => void;
  now?: () => Date;
  logger?: { error(message: string, err: unknown): void };
}): ProactiveScheduler {
  const now = options.now ?? (() => new Date());
  let settings: HoldSettings | null = null;
  let hold: HoldState = NOT_HOLDING;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  function refreshHold(): void {
    const next = computeHold(settings, options.focus(), now());
    if (next.holding !== hold.holding || next.reason !== hold.reason) {
      hold = next;
      options.onHoldChange(hold);
    }
  }

  async function tick(userJustReturned = false): Promise<void> {
    if (running) return;
    running = true;
    try {
      settings = parseHoldSettings(await options.api.proactiveSettings()) ?? settings;
      refreshHold();
      if (hold.holding || options.isPaused()) return;
      if (!userJustReturned && options.idleSeconds() > ACTIVE_IDLE_SECONDS) return;
      for (const kind of ["morning", "wrap_up"] as const) {
        const briefing = parseBriefing(await options.api.deliverBriefing(kind));
        if (briefing) {
          options.onBriefing(briefing);
          return;
        }
      }
    } catch (err) {
      options.logger?.error("Proactive check failed", err);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), PROACTIVE_TICK_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    userReturned() {
      void tick(true);
    },
    hold() {
      // Focus changes arrive between ticks — keep this current too.
      refreshHold();
      return hold;
    },
  };
}
