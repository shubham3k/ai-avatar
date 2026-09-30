-- CreateTable
CREATE TABLE "MemoryFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ActivityEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "provider" TEXT,
    "undo" TEXT,
    "undoneAt" DATETIME
);

-- CreateIndex
CREATE INDEX "MemoryFact_userId_updatedAt_idx" ON "MemoryFact"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ActivityEntry_userId_createdAt_idx" ON "ActivityEntry"("userId", "createdAt");
