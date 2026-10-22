-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StageRun" (
    "stale" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_StageRun" ("completionTokens", "confirmedAt", "createdAt", "error", "id", "projectId", "promptTokens", "runId", "stage", "status", "updatedAt") SELECT "completionTokens", "confirmedAt", "createdAt", "error", "id", "projectId", "promptTokens", "runId", "stage", "status", "updatedAt" FROM "StageRun";
DROP TABLE "StageRun";
ALTER TABLE "new_StageRun" RENAME TO "StageRun";
CREATE INDEX "StageRun_projectId_stage_updatedAt_idx" ON "StageRun"("projectId", "stage", "updatedAt");
CREATE UNIQUE INDEX "StageRun_projectId_runId_stage_key" ON "StageRun"("projectId", "runId", "stage");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
