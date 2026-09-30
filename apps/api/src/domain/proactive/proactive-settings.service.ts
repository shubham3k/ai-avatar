import type { PrismaClient, ProactiveSettings } from "@prisma/client";
import type { BriefingKind, BriefingMode, ProactiveSettingsDto } from "@ai-agent/shared";
import { prisma as defaultPrisma } from "../../lib/prisma.js";

export type ProactiveSettingsRecord = ProactiveSettings;

export function toProactiveSettingsDto(row: ProactiveSettings): ProactiveSettingsDto {
  return {
    briefingEnabled: row.briefingEnabled,
    briefingMode: (["written", "spoken", "both"].includes(row.briefingMode) ? row.briefingMode : "written") as BriefingMode,
    briefingWeekdaysOnly: row.briefingWeekdaysOnly,
    wrapUpEnabled: row.wrapUpEnabled,
    wrapUpTime: row.wrapUpTime,
    preMeetingBriefEnabled: row.preMeetingBriefEnabled,
    followUpEnabled: row.followUpEnabled,
    followUpDays: row.followUpDays,
    promiseRemindersEnabled: row.promiseRemindersEnabled,
    promiseRemindTime: row.promiseRemindTime,
    promiseSameDayLeadHours: row.promiseSameDayLeadHours,
    holdDuringFocus: row.holdDuringFocus,
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
  };
}

/**
 * ADR-006 M5: the user's proactive settings (one row, created with the
 * defaults on first read) and the "delivered today" markers.
 */
export function createProactiveSettingsService(dependencies?: { prisma?: PrismaClient }) {
  const prisma = dependencies?.prisma ?? defaultPrisma;

  return {
    get(userId: string): Promise<ProactiveSettings> {
      return prisma.proactiveSettings.upsert({ where: { userId }, update: {}, create: { userId } });
    },

    async update(
      userId: string,
      patch: { [K in keyof ProactiveSettingsDto]?: ProactiveSettingsDto[K] | undefined },
    ): Promise<ProactiveSettings> {
      await this.get(userId);
      const data = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
      return prisma.proactiveSettings.update({ where: { userId }, data });
    },

    /**
     * Records a briefing as delivered for `dateKey`. Atomic: returns false
     * if another request already claimed today, so two triggers arriving
     * together (unlock + activity tick) can't produce two briefings.
     */
    async claimDelivery(userId: string, kind: BriefingKind, dateKey: string): Promise<boolean> {
      await this.get(userId);
      const field = kind === "morning" ? "lastBriefingOn" : "lastWrapUpOn";
      const result = await prisma.proactiveSettings.updateMany({
        where: { userId, OR: [{ [field]: null }, { [field]: { not: dateKey } }] },
        data: { [field]: dateKey },
      });
      return result.count === 1;
    },
  };
}

export type ProactiveSettingsService = ReturnType<typeof createProactiveSettingsService>;
