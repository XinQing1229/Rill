CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activeProvider" TEXT NOT NULL DEFAULT 'deepseek',
    "activeModel" TEXT NOT NULL DEFAULT 'deepseek-flash',
    "deepseekKeyCiphertext" TEXT,
    "deepseekKeyNonce" TEXT,
    "deepseekKeyAuthTag" TEXT,
    "glmKeyCiphertext" TEXT,
    "glmKeyNonce" TEXT,
    "glmKeyAuthTag" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
