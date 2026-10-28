import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const mode = process.argv[2] === 'ai' ? 'ai' : 'local';
const directory = path.resolve(`.test-data/e2e-${mode}`);
mkdirSync(directory, { recursive: true });
const databasePath = path.join(directory, 'library.db');
const database = new DatabaseSync(databasePath);
if (!database.prepare("SELECT name FROM sqlite_master WHERE name='Paper'").get()) {
  for (const entry of readdirSync('prisma/migrations').filter(
    (name) => name !== 'migration_lock.toml',
  ))
    database.exec(readFileSync(`prisma/migrations/${entry}/migration.sql`, 'utf8'));
}
if (
  !database
    .prepare('PRAGMA table_info(Paper)')
    .all()
    .some((column) => column.name === 'lastPosition')
) {
  database.exec(
    readFileSync('prisma/migrations/20261027090000_continuous_reading/migration.sql', 'utf8'),
  );
}
if (!database.prepare("SELECT name FROM sqlite_master WHERE name='Bookshelf'").get()) {
  database.exec(
    readFileSync('prisma/migrations/20261028160000_project_bookshelves/migration.sql', 'utf8'),
  );
}
if (
  !database
    .prepare('PRAGMA table_info(AppPreference)')
    .all()
    .some((column) => column.name === 'theme')
) {
  database.exec(
    readFileSync('prisma/migrations/20261028190000_manual_reading_themes/migration.sql', 'utf8'),
  );
}
database.close();
const tsconfig = `.test-data/tsconfig-${mode}.json`;
writeFileSync(
  tsconfig,
  JSON.stringify({
    extends: '../tsconfig.json',
    compilerOptions: { baseUrl: '..', paths: { '@/*': ['./src/*'] } },
    include: [
      '../next-env.d.ts',
      '../src/**/*.ts',
      '../src/**/*.tsx',
      `../.next-e2e-${mode}/types/**/*.ts`,
      `../.next-e2e-${mode}/dev/types/**/*.ts`,
    ],
    exclude: ['../node_modules'],
  }),
);
const server = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    mode === 'ai' ? '3101' : '3100',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      DATA_DIR: directory,
      DATABASE_URL: `file:${databasePath.replaceAll('\\', '/')}`,
      NEXT_DIST_DIR: `.next-e2e-${mode}`,
      NEXT_TEST_TSCONFIG: tsconfig,
      NEXT_TELEMETRY_DISABLED: '1',
      AI_ENABLED: mode === 'ai' ? 'true' : 'false',
      OPENAI_API_KEY: mode === 'ai' ? 'local-test-key-not-a-real-secret' : '',
      OPENAI_BASE_URL: 'http://127.0.0.1:4123/v1',
      OPENAI_MODEL: 'test-simulator',
      AI_CHUNK_CHARS: '1200',
      AI_MAX_INPUT_CHARS: '14000',
      AI_TIMEOUT_MS: '10000',
      NO_PROXY: '127.0.0.1,localhost',
    },
  },
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.kill();
  });
server.on('exit', (code) => process.exit(code || 0));
