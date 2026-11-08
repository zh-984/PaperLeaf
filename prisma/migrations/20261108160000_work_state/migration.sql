CREATE TABLE "WorkPreference" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
    "mode" TEXT NOT NULL DEFAULT 'read',
    "documentId" TEXT NOT NULL DEFAULT ''
);
