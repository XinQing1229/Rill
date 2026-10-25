-- CreateTable
CREATE TABLE "ProseBook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "targetChapters" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "completedRevision" INTEGER,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProseBook_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProseChapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "relativePath" TEXT NOT NULL,
    "generationStatus" TEXT NOT NULL DEFAULT 'pending',
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "fileStatus" TEXT NOT NULL DEFAULT 'missing',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "observedHash" TEXT,
    "confirmedHash" TEXT,
    "outlineRevision" INTEGER NOT NULL DEFAULT 0,
    "beatChapterRevision" INTEGER NOT NULL DEFAULT 0,
    "prefixFingerprint" TEXT,
    "error" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProseChapter_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "ProseBook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProseReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "dependencyFingerprint" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verdict" TEXT,
    "data" TEXT,
    "overrideReason" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProseReview_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "ProseChapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProseSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "prefixFingerprint" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "data" TEXT,
    "status" TEXT NOT NULL,
    "acceptedAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProseSummary_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "ProseChapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProseAcceptance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "summaryId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "dependencyFingerprint" TEXT NOT NULL,
    "overrideReason" TEXT,
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProseAcceptance_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "ProseChapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProseOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "baseHash" TEXT,
    "resultHash" TEXT,
    "dependencyFingerprint" TEXT NOT NULL,
    "candidatePath" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'prepared',
    "error" TEXT,
    CONSTRAINT "ProseOperation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProseUsage" (
    "traceId" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    CONSTRAINT "ProseUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProseDeletion" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ProseBook_projectId_key" ON "ProseBook"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProseChapter_bookId_chapterNumber_key" ON "ProseChapter"("bookId", "chapterNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProseAcceptance_chapterId_reviewId_summaryId_key" ON "ProseAcceptance"("chapterId", "reviewId", "summaryId");
