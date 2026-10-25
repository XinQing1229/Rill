-- CreateTable
CREATE TABLE "BookExportSettings" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BookExportSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookExportSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "evidenceFingerprint" TEXT NOT NULL,
    "manifestPath" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "chapterCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookExportSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookExportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "previewToken" TEXT NOT NULL,
    "formats" TEXT NOT NULL,
    "snapshotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "token" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookExportJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BookExportJob_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "BookExportSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookExportFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "path" TEXT,
    "hash" TEXT,
    "size" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BookExportFile_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BookExportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BookExportJob_snapshotId_key" ON "BookExportJob"("snapshotId");

-- CreateIndex
CREATE INDEX "BookExportJob_status_idx" ON "BookExportJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BookExportJob_projectId_requestId_key" ON "BookExportJob"("projectId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "BookExportFile_jobId_format_key" ON "BookExportFile"("jobId", "format");
