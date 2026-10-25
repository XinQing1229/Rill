CREATE TABLE "PremiseRevision" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "projectId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL,
 "feedback" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'generating',
 "data" TEXT,
 "baseHash" TEXT NOT NULL,
 "runId" TEXT NOT NULL,
 "originalStatus" TEXT NOT NULL,
 "adoptedAt" DATETIME,
 "error" TEXT,
 "promptTokens" INTEGER NOT NULL DEFAULT 0,
 "completionTokens" INTEGER NOT NULL DEFAULT 0,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "PremiseRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PremiseRevision_projectId_requestId_key" ON "PremiseRevision"("projectId", "requestId");
