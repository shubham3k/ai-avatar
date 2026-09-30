-- AlterTable
ALTER TABLE "PendingAction" ADD COLUMN "result" TEXT;

-- CreateTable
CREATE TABLE "McpConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "command" TEXT,
    "args" TEXT NOT NULL DEFAULT '[]',
    "folders" TEXT NOT NULL DEFAULT '[]',
    "envEncrypted" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "McpToolPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "McpToolPolicy_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "McpConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "McpConnection_userId_idx" ON "McpConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "McpToolPolicy_connectionId_toolName_key" ON "McpToolPolicy"("connectionId", "toolName");
