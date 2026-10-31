ALTER TABLE "CitationSettings" ADD COLUMN "markerSuperscript" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CitationSettings" ADD COLUMN "bibliographyIndent" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "CitationSettings" ADD COLUMN "indentCharacters" REAL NOT NULL DEFAULT 2;
