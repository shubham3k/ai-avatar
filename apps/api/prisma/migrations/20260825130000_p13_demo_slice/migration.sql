-- AlterEnum
ALTER TYPE "SignalType" ADD VALUE 'user_action_required';

-- DropIndex
DROP INDEX "Signal_userId_sourceType_sourceId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Intervention_signalId_key" ON "Intervention"("signalId");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_userId_type_sourceType_sourceId_key" ON "Signal"("userId", "type", "sourceType", "sourceId");

