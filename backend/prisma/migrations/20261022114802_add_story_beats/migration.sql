-- CreateTable
CREATE TABLE "BeatBook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "confirmedRevision" INTEGER,
    "outlineRevision" INTEGER NOT NULL,
    "targetChapters" INTEGER NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BeatBook_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BeatChapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "beatBookId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "data" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BeatChapter_beatBookId_fkey" FOREIGN KEY ("beatBookId") REFERENCES "BeatBook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BeatBook_projectId_key" ON "BeatBook"("projectId");

-- CreateIndex
CREATE INDEX "BeatChapter_beatBookId_status_idx" ON "BeatChapter"("beatBookId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BeatChapter_beatBookId_chapterNumber_key" ON "BeatChapter"("beatBookId", "chapterNumber");
