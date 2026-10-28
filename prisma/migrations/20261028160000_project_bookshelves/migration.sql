CREATE TABLE "Bookshelf" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "collapsed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Bookshelf_name_key" ON "Bookshelf"("name");
ALTER TABLE "Paper" ADD COLUMN "shelfId" TEXT REFERENCES "Bookshelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Paper_shelfId_idx" ON "Paper"("shelfId");
CREATE TABLE "AppPreference" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
  "defaultView" TEXT NOT NULL DEFAULT 'report',
  "showAiNotice" BOOLEAN NOT NULL DEFAULT true,
  "autoInterpret" BOOLEAN NOT NULL DEFAULT true,
  "reduceMotion" BOOLEAN NOT NULL DEFAULT false,
  "readerFitWidth" BOOLEAN NOT NULL DEFAULT true,
  "defaultShelfCollapsed" BOOLEAN NOT NULL DEFAULT false
);
