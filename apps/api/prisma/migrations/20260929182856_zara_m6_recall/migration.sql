-- CreateTable
CREATE TABLE "RecallChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceDate" DATETIME,
    "url" TEXT,
    "contentHash" TEXT NOT NULL,
    "embedding" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RecallSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "documentsFolder" TEXT,
    "documentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "peopleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailHistoryDays" INTEGER NOT NULL DEFAULT 30,
    "backfillPageToken" TEXT,
    "backfillDoneForDays" INTEGER,
    "lastIndexedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "RecallChunk_userId_sourceType_sourceId_idx" ON "RecallChunk"("userId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RecallChunk_userId_sourceType_sourceId_chunkIndex_key" ON "RecallChunk"("userId", "sourceType", "sourceId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "RecallSettings_userId_key" ON "RecallSettings"("userId");
