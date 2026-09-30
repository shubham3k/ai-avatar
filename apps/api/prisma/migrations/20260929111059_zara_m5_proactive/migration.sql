-- AlterTable
ALTER TABLE "Email" ADD COLUMN "expectsReply" BOOLEAN;
ALTER TABLE "Email" ADD COLUMN "followUpCheckedAt" DATETIME;
ALTER TABLE "Email" ADD COLUMN "repliedAt" DATETIME;
ALTER TABLE "Email" ADD COLUMN "sentAnalyzedAt" DATETIME;

-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN "origin" TEXT;
ALTER TABLE "Reminder" ADD COLUMN "sourceEmailId" TEXT;

-- CreateTable
CREATE TABLE "ProactiveSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "briefingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "briefingMode" TEXT NOT NULL DEFAULT 'written',
    "briefingWeekdaysOnly" BOOLEAN NOT NULL DEFAULT false,
    "wrapUpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "wrapUpTime" TEXT NOT NULL DEFAULT '18:00',
    "preMeetingBriefEnabled" BOOLEAN NOT NULL DEFAULT true,
    "followUpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "followUpDays" INTEGER NOT NULL DEFAULT 3,
    "promiseRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "promiseRemindTime" TEXT NOT NULL DEFAULT '10:00',
    "promiseSameDayLeadHours" INTEGER NOT NULL DEFAULT 2,
    "holdDuringFocus" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" TEXT NOT NULL DEFAULT '22:00',
    "quietHoursEnd" TEXT NOT NULL DEFAULT '07:00',
    "lastBriefingOn" TEXT,
    "lastWrapUpOn" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ProactiveSettings_userId_key" ON "ProactiveSettings"("userId");
