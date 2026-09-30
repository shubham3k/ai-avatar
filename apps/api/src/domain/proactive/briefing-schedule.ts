import type { BriefingKind } from "@ai-agent/shared";
import { clockMinutes, isWeekend, localDateKey, minutesOfDay } from "./local-time.js";

/** No morning briefing before this local hour — the PC may be on overnight. */
export const EARLIEST_BRIEFING_HOUR = 5;

export interface BriefingScheduleSettings {
  briefingEnabled: boolean;
  briefingWeekdaysOnly: boolean;
  wrapUpEnabled: boolean;
  wrapUpTime: string;
  lastBriefingOn: string | null;
  lastWrapUpOn: string | null;
}

/**
 * ADR-006 §6: is a briefing due right now? The desktop only asks while the
 * user is actually at the PC (just unlocked, or active), so "due" here is
 * purely about the calendar:
 * - morning: once a day, from 05:00 until the wrap-up time (after that the
 *   wrap-up covers the day); optionally weekdays only.
 * - wrap-up: once a day, from the wrap-up time until midnight.
 */
export function isBriefingDue(kind: BriefingKind, settings: BriefingScheduleSettings, now: Date): boolean {
  const today = localDateKey(now);
  const wrapUpAt = clockMinutes(settings.wrapUpTime) ?? 18 * 60;
  const nowMinutes = minutesOfDay(now);

  if (kind === "morning") {
    if (!settings.briefingEnabled || settings.lastBriefingOn === today) return false;
    if (settings.briefingWeekdaysOnly && isWeekend(now)) return false;
    return nowMinutes >= EARLIEST_BRIEFING_HOUR * 60 && nowMinutes < wrapUpAt;
  }
  if (!settings.wrapUpEnabled || settings.lastWrapUpOn === today) return false;
  return nowMinutes >= wrapUpAt;
}
