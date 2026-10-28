const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { prepareProfile, migrateDatabase } = require('./data.cjs');

async function main() {
  const serverRoot = process.env.PAPERLEAF_SERVER_ROOT;
  const profile = process.env.PAPERLEAF_PROFILE;
  if (!serverRoot || !profile) throw new Error('桌面服务启动参数缺失');
  const local = prepareProfile(profile);
  const requireServer = createRequire(path.join(serverRoot, 'package.json'));
  const config = requireServer('dotenv').parse(fs.readFileSync(local.config));
  for (const key of ['AI_ENABLED', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']) {
    if (config[key] !== undefined) process.env[key] = config[key];
  }
  migrateDatabase(local.database, path.join(serverRoot, 'prisma/migrations'));
  process.env.DATA_DIR = local.data;
  process.env.DATABASE_URL = `file:${local.database.replaceAll('\\', '/')}`;
  process.env.PAPERLEAF_DESKTOP = '1';
  process.env.NODE_ENV = 'production';
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  process.env.HOSTNAME = '127.0.0.1';
  process.chdir(serverRoot);
  process.on('message', (message) => {
    if (message?.type === 'shutdown') process.emit('SIGTERM');
  });
  await import(pathToFileURL(path.join(serverRoot, 'server.js')).href);
}
main().catch((error) => {
  console.error(
    '[desktop] Startup failed:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exit(1);
});
