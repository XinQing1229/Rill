CREATE TABLE "ProjectCoverState" (
 "projectId" TEXT NOT NULL PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 0,
 "currentAssetId" TEXT, "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "ProjectCoverState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "CoverAsset" (
 "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "sourceFormat" TEXT NOT NULL,
 "mimeType" TEXT NOT NULL, "path" TEXT NOT NULL, "thumbnailPath" TEXT NOT NULL,
 "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "size" INTEGER NOT NULL,
 "sha256" TEXT NOT NULL, "originalFilename" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "deletedAt" DATETIME,
 CONSTRAINT "CoverAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CoverAsset_projectId_deletedAt_createdAt_idx" ON "CoverAsset"("projectId", "deletedAt", "createdAt");
