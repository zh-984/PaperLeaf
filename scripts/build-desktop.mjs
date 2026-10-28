import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  process.env.ELECTRON_GET_USE_PROXY = 'true';
  process.env.GLOBAL_AGENT_HTTP_PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
}
const { build, Platform, Arch } = require('electron-builder');
const electronRoot = path.dirname(require.resolve('electron/package.json'));
if (!existsSync(path.join(electronRoot, 'dist/electron.exe'))) {
  const result = spawnSync(process.execPath, [path.join(electronRoot, 'install.js')], {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const localNsis = path.resolve('.desktop-cache/nsis/nsis-bundle');
if (existsSync(path.join(localNsis, 'makensis.cmd'))) {
  process.env.ELECTRON_BUILDER_NSIS_DIR = localNsis;
  process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR = localNsis;
}
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
process.env.CSC_LINK = '';
process.env.WIN_CSC_LINK = '';
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ||= '1';
await build({
  projectDir: path.resolve('.desktop-build/app'),
  // Resume installer creation from an already validated desktop directory.
  ...(process.argv.includes('--installer-only')
    ? { prepackaged: path.resolve('release/win-unpacked') }
    : {}),
  config: require('../desktop/electron-builder.cjs'),
  targets: Platform.WINDOWS.createTarget(
    process.argv.includes('--dir') ? ['dir'] : ['nsis'],
    Arch.x64,
  ),
  publish: 'never',
});
