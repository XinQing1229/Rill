-- AlterTable
ALTER TABLE "Project" ADD COLUMN "deletedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");
