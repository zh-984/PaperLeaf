import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

process.env.AI_ENABLED = 'false';
process.env.OPENAI_API_KEY = '';
mkdirSync('.test-data/unit', { recursive: true });
process.env.DATA_DIR = mkdtempSync(path.resolve('.test-data/unit/run-'));
process.env.DATABASE_URL = `file:${path.join(process.env.DATA_DIR, 'library.db').replaceAll('\\', '/')}`;
const sqlite = new DatabaseSync(path.join(process.env.DATA_DIR, 'library.db'));
const migrations = readdirSync('prisma/migrations').filter(
  (entry) => entry !== 'migration_lock.toml',
);
const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE name='Paper'").get();
if (!exists)
  for (const migration of migrations)
    sqlite.exec(readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
sqlite.close();
