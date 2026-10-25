-- CreateTable
CREATE TABLE "ProseRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "baseHash" TEXT NOT NULL,
    "dependencyFingerprint" TEXT NOT NULL,
    "originalContent" TEXT NOT NULL,
    "feedback" TEXT NOT NULL,
    "reviewId" TEXT,
    "suggestionsData" TEXT NOT NULL,
    "content" TEXT,
    "resultHash" TEXT,
    "explanation" TEXT,
    "responsesData" TEXT NOT NULL DEFAULT '[]',
    "changesData" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'generating',
    "error" TEXT,
    "runId" TEXT NOT NULL,
    "originalStatus" TEXT NOT NULL,
    "applyRequestId" TEXT,
    "applyPhase" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "appliedAt" DATETIME,
    CONSTRAINT "ProseRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProseRevision_projectId_chapterNumber_createdAt_idx" ON "ProseRevision"("projectId", "chapterNumber", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProseRevision_projectId_requestId_key" ON "ProseRevision"("projectId", "requestId");

