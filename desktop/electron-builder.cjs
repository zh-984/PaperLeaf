module.exports = {
  appId: 'org.paperleaf.reader',
  productName: '知页 Paperleaf',
  executableName: 'Paperleaf',
  electronVersion: '45.0.0',
  electronDist: require('node:path').join(__dirname, '../node_modules/electron/dist'),
  directories: {
    app: require('node:path').join(__dirname, '../.desktop-build/app'),
    output: require('node:path').join(__dirname, '../release'),
    buildResources: require('node:path').join(__dirname, 'assets'),
  },
  files: [
    'main.cjs',
    'preload.cjs',
    'data.cjs',
    'loading.html',
    'assets/**/*',
    'package.json',
    '!node_modules/**/*',
  ],
  asar: true,
  npmRebuild: false,
  toolsets: { nsis: '1.2.1' },
  async afterPack(context) {
    const path = require('node:path');
    const { cp } = require('node:fs/promises');
    const source = path.join(__dirname, '../.desktop-build/server');
    const destination = path.join(context.appOutDir, 'resources/server');
    // electron-builder excludes node_modules in generic resource matchers. Our server is
    // already sanitized and fully materialized; preserve its exact runtime tree here.
    await cp(source, destination, { recursive: true, dereference: true });
  },
  extraResources: [
    {
      from: require('node:path').join(__dirname, 'server-bootstrap.cjs'),
      to: 'desktop/server-bootstrap.cjs',
    },
    { from: require('node:path').join(__dirname, 'data.cjs'), to: 'desktop/data.cjs' },
  ],
  win: {
    icon: require('node:path').join(__dirname, 'assets/icon.ico'),
    target: ['nsis'],
    artifactName: 'Paperleaf-Setup-${version}-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: '知页 Paperleaf',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    installerLanguages: ['zh_CN', 'en_US'],
    language: '2052',
  },
};
