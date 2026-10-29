CREATE TABLE "Reference" (
  "paperId" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL DEFAULT 'journal',
  "title" TEXT NOT NULL DEFAULT '',
  "authors" TEXT NOT NULL DEFAULT '',
  "year" TEXT NOT NULL DEFAULT '',
  "journal" TEXT NOT NULL DEFAULT '',
  "volume" TEXT NOT NULL DEFAULT '',
  "issue" TEXT NOT NULL DEFAULT '',
  "pages" TEXT NOT NULL DEFAULT '',
  "doi" TEXT NOT NULL DEFAULT '',
  "publisher" TEXT NOT NULL DEFAULT '',
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Reference_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CitationSettings" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
  "markerTemplate" TEXT NOT NULL DEFAULT '[{{number}}]',
  "referenceTemplate" TEXT NOT NULL DEFAULT '[{{number}}] {{authors}}. {{title}}[{{type}}]. {{journal}}, {{year}}, {{volume}}({{issue}}): {{pages}}. {{doi}}'
);
