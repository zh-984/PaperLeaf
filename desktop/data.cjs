const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const defaultConfig = [
  '# 知页桌面版：通过左下角“设置与隐私 → AI 配置”修改，保存立即生效。',
  '# 开启后会将文献全文文本分段发送给配置的 AI 服务。',
  'AI_ENABLED="false"',
  'OPENAI_API_KEY=""',
  'OPENAI_BASE_URL="https://api.openai.com/v1"',
  'OPENAI_MODEL="gpt-4o-mini"',
  '',
].join('\n');

function prepareProfile(profile) {
  fs.mkdirSync(profile, { recursive: true });
  for (const directory of ['data/uploads', 'data/tmp', 'logs'])
    fs.mkdirSync(path.join(profile, directory), { recursive: true });
  const config = path.join(profile, 'ai.env');
  if (!fs.existsSync(config)) fs.writeFileSync(config, defaultConfig, { mode: 0o600 });
  return {
    config,
    data: path.join(profile, 'data'),
    database: path.join(profile, 'data/library.db'),
  };
}

function migrateDatabase(databasePath, migrationsPath) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec(
      'CREATE TABLE IF NOT EXISTS "_PaperleafMigrations" ("name" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    const hasPrismaHistory = Boolean(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'")
        .get(),
    );
    let backedUp = false;
    for (const name of fs.readdirSync(migrationsPath).sort()) {
      const file = path.join(migrationsPath, name, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      const sql = fs.readFileSync(file, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = db
        .prepare('SELECT checksum FROM "_PaperleafMigrations" WHERE name=?')
        .get(name);
      if (applied) {
        if (applied.checksum !== checksum)
          throw new Error(`已应用的数据库迁移发生变化：${name}。请保留数据并联系维护者。`);
        continue;
      }
      const fromWeb =
        hasPrismaHistory &&
        db
          .prepare(
            'SELECT checksum FROM "_prisma_migrations" WHERE migration_name=? AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
          )
          .get(name);
      if (fromWeb && fromWeb.checksum !== checksum)
        throw new Error(`旧版数据库迁移校验失败：${name}`);
      if (
        !fromWeb &&
        !backedUp &&
        db.prepare("SELECT name FROM sqlite_master WHERE name='Paper'").get() &&
        db.prepare('SELECT COUNT(*) AS count FROM Paper').get().count > 0
      ) {
        db.prepare('VACUUM INTO ?').run(databasePath + '.backup-' + Date.now());
        backedUp = true;
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!fromWeb) db.exec(sql);
        db.prepare('INSERT INTO "_PaperleafMigrations" (name,checksum) VALUES (?,?)').run(
          name,
          checksum,
        );
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  } finally {
    db.close();
  }
}
module.exports = { defaultConfig, prepareProfile, migrateDatabase };
