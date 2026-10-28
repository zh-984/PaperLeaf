CREATE TABLE "_new_AppPreference" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
  "defaultView" TEXT NOT NULL DEFAULT 'report',
  "showAiNotice" BOOLEAN NOT NULL DEFAULT true,
  "autoInterpret" BOOLEAN NOT NULL DEFAULT false,
  "reduceMotion" BOOLEAN NOT NULL DEFAULT false,
  "readerFitWidth" BOOLEAN NOT NULL DEFAULT true,
  "defaultShelfCollapsed" BOOLEAN NOT NULL DEFAULT false,
  "theme" TEXT NOT NULL DEFAULT 'green'
);
INSERT INTO "_new_AppPreference" ("id","defaultView","showAiNotice","autoInterpret","reduceMotion","readerFitWidth","defaultShelfCollapsed","theme")
SELECT "id","defaultView","showAiNotice",false,"reduceMotion","readerFitWidth","defaultShelfCollapsed",'green' FROM "AppPreference";
DROP TABLE "AppPreference";
ALTER TABLE "_new_AppPreference" RENAME TO "AppPreference";
