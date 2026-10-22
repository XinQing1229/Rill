-- CreateTable
CREATE TABLE "Outline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "targetChapters" INTEGER NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'planning',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "planRevision" INTEGER NOT NULL DEFAULT 0,
    "planConfirmedRevision" INTEGER,
    "confirmedRevision" INTEGER,
    "planData" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Outline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutlineBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outlineId" TEXT NOT NULL,
    "planRevision" INTEGER NOT NULL,
    "startChapter" INTEGER NOT NULL,
    "endChapter" INTEGER NOT NULL,
    "segmentId" TEXT NOT NULL,
    "data" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OutlineBatch_outlineId_fkey" FOREIGN KEY ("outlineId") REFERENCES "Outline" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutlineUsage" (
    "traceId" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Outline_projectId_key" ON "Outline"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "OutlineBatch_outlineId_planRevision_startChapter_key" ON "OutlineBatch"("outlineId", "planRevision", "startChapter");

