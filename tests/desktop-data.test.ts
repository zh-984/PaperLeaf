import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { prepareProfile, migrateDatabase } = require('../desktop/data.cjs') as {
  prepareProfile: (folder: string) => { config: string; data: string; database: string };
  migrateDatabase: (file: string, migrations: string) => void;
};
mkdirSync('.test-data/desktop-unit', { recursive: true });
describe('desktop local storage', () => {
  it('upgrades existing preferences to manual interpretation without losing reading settings or papers', () => {
    const profile = mkdtempSync(path.resolve('.test-data/desktop-unit/themes-'));
    const { database } = prepareProfile(profile);
    const db = new DatabaseSync(database);
    const old = readdirSync('prisma/migrations').filter(
      (name) => name !== 'migration_lock.toml' && name < '20261028190000_manual_reading_themes',
    );
    for (const name of old)
      db.exec(readFileSync(path.join('prisma/migrations', name, 'migration.sql'), 'utf8'));
    db.exec(
      "INSERT INTO Paper (id,title,filePath,fileName,fileSize,pageCount,updatedAt) VALUES ('keep','保留文献','keep.pdf','keep.pdf',100,3,CURRENT_TIMESTAMP)",
    );
    db.exec(
      "INSERT INTO AppPreference (id,defaultView,autoInterpret,showAiNotice,reduceMotion,readerFitWidth,defaultShelfCollapsed) VALUES ('local','original',true,false,true,false,true)",
    );
    // Record the exact legacy checksums, as a previously installed desktop app would.
    db.exec('CREATE TABLE _PaperleafMigrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
    const { createHash } = require('node:crypto');
    for (const name of old)
      db.prepare('INSERT INTO _PaperleafMigrations VALUES (?,?)').run(
        name,
        createHash('sha256')
          .update(readFileSync(path.join('prisma/migrations', name, 'migration.sql')))
          .digest('hex'),
      );
    db.close();
    migrateDatabase(database, path.resolve('prisma/migrations'));
    const upgraded = new DatabaseSync(database);
    expect(upgraded.prepare("SELECT * FROM AppPreference WHERE id='local'").get()).toMatchObject({
      autoInterpret: 0,
      theme: 'green',
      defaultView: 'original',
      showAiNotice: 0,
      reduceMotion: 1,
      readerFitWidth: 0,
      defaultShelfCollapsed: 1,
    });
    expect(upgraded.prepare("SELECT title FROM Paper WHERE id='keep'").get()?.title).toBe(
      '保留文献',
    );
    upgraded.close();
    expect(
      readdirSync(path.dirname(database)).some((name) => name.startsWith('library.db.backup-')),
    ).toBe(true);
  });
  it('initializes a private profile, never overwrites AI settings, and migrates idempotently', () => {
    const profile = mkdtempSync(path.resolve('.test-data/desktop-unit/profile-'));
    const local = prepareProfile(profile);
    expect(readFileSync(local.config, 'utf8')).toContain('AI_ENABLED="false"');
    writeFileSync(local.config, 'AI_ENABLED="true"\nOPENAI_API_KEY="local-test-value"');
    prepareProfile(profile);
    expect(readFileSync(local.config, 'utf8')).toContain('local-test-value');
    migrateDatabase(local.database, path.resolve('prisma/migrations'));
    migrateDatabase(local.database, path.resolve('prisma/migrations'));
    const db = new DatabaseSync(local.database);
    expect(db.prepare('SELECT COUNT(*) AS count FROM Paper').get()?.count).toBe(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM _PaperleafMigrations').get()?.count,
    ).toBeGreaterThan(0);
    db.close();
  });
  it('recognizes existing Prisma migration history without recreating user tables', () => {
    const profile = mkdtempSync(path.resolve('.test-data/desktop-unit/legacy-'));
    const { database } = prepareProfile(profile);
    const db = new DatabaseSync(database);
    const name = readdirSync('prisma/migrations').find((name) => name !== 'migration_lock.toml')!;
    const sql = readFileSync(path.join('prisma/migrations', name, 'migration.sql'), 'utf8');
    const { createHash } = require('node:crypto');
    db.exec(sql);
    db.exec(
      `INSERT INTO Paper (id,title,filePath,fileName,fileSize,pageCount,updatedAt) VALUES ('existing-paper','已有文献','local.pdf','原文件.pdf',100,13,CURRENT_TIMESTAMP)`,
    );
    db.exec(
      'CREATE TABLE _prisma_migrations (migration_name TEXT, checksum TEXT, finished_at TEXT, rolled_back_at TEXT)',
    );
    db.prepare('INSERT INTO _prisma_migrations VALUES (?,?,?,NULL)').run(
      name,
      createHash('sha256').update(sql).digest('hex'),
      '2026-10-27',
    );
    db.close();
    expect(() => migrateDatabase(database, path.resolve('prisma/migrations'))).not.toThrow();
    const upgraded = new DatabaseSync(database);
    expect(
      upgraded.prepare('SELECT title,lastPosition FROM Paper WHERE id=?').get('existing-paper'),
    ).toMatchObject({ title: '已有文献', lastPosition: 0 });
    upgraded.close();
    expect(
      readdirSync(path.dirname(database)).some((name) => name.startsWith('library.db.backup-')),
    ).toBe(true);
  });
});
