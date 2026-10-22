-- AlterTable
ALTER TABLE "Project" ADD COLUMN "runId" TEXT;

-- CreateTable
CREATE TABLE "StageRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StageRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StageRun_projectId_stage_updatedAt_idx" ON "StageRun"("projectId", "stage", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StageRun_projectId_runId_stage_key" ON "StageRun"("projectId", "runId", "stage");
