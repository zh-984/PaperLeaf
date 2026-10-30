const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { prepareProfile } = require('./data.cjs');

app.setName('Paperleaf');
const testing = process.env.PAPERLEAF_DESKTOP_TEST === '1';
const profile =
  testing && process.env.PAPERLEAF_TEST_PROFILE
    ? path.resolve(process.env.PAPERLEAF_TEST_PROFILE)
    : path.join(app.getPath('appData'), 'Paperleaf');
app.setPath('userData', profile);
app.setAppUserModelId('org.paperleaf.reader');

let window;
let backend;
let baseUrl = '';
let quitting = false;
let backendExited = false;
let bootLog;
function log(text) {
  bootLog?.write(text);
}
async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
async function ready(url) {
  for (let i = 0; i < 300; i++) {
    if (backendExited)
      throw new Error('本地服务启动失败。可通过“帮助 → 打开日志目录”查看详细原因。');
    const healthy = await new Promise((resolve) => {
      const request = http.get(`${url}/api/settings`, { timeout: 1200 }, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve(response.statusCode === 200 && JSON.parse(body).desktopMode === true);
          } catch {
            resolve(false);
          }
        });
      });
      request.on('timeout', () => {
        request.destroy();
        resolve(false);
      });
      request.on('error', () => resolve(false));
    });
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('本地服务启动超时，请重新打开程序，或检查日志。');
}
function openExternal(url) {
  try {
    const target = new URL(url);
    if (target.protocol === 'https:' || target.protocol === 'http:')
      void shell.openExternal(target.href);
  } catch {
    /* Ignore malformed navigation. */
  }
}
async function desktopAction(action, local) {
  const content = window.webContents;
  const themeColors = {
    'theme:green': '#edf1e9',
    'theme:blue': '#eaf2fb',
    'theme:yellow': '#faf3dc',
    'theme:white': '#ffffff',
  };
  if (Object.hasOwn(themeColors, action)) {
    window.setTitleBarOverlay({ color: themeColors[action], symbolColor: '#000000', height: 46 });
    return;
  }
  switch (action) {
    case 'import':
      return content.executeJavaScript("document.querySelector('input[type=file]')?.click()", true);
    case 'data': {
      const error = await shell.openPath(local.data);
      if (error) throw new Error('无法打开数据目录');
      return;
    }
    case 'logs': {
      const error = await shell.openPath(path.join(profile, 'logs'));
      if (error) throw new Error('无法打开日志目录');
      return;
    }
    case 'quit':
      app.quit();
      return;
    case 'restart':
      app.relaunch();
      app.quit();
      return;
    case 'undo':
      content.undo();
      return;
    case 'redo':
      content.redo();
      return;
    case 'cut':
      content.cut();
      return;
    case 'copy':
      content.copy();
      return;
    case 'paste':
      content.paste();
      return;
    case 'selectAll':
      content.selectAll();
      return;
    case 'find':
      return content.executeJavaScript("window.dispatchEvent(new Event('paperleaf:search'))", true);
    case 'reload':
      content.reload();
      return;
    case 'zoomIn':
      content.setZoomFactor(Math.min(1.75, content.getZoomFactor() + 0.1));
      return;
    case 'zoomOut':
      content.setZoomFactor(Math.max(0.75, content.getZoomFactor() - 0.1));
      return;
    case 'resetZoom':
      content.setZoomFactor(1);
      return;
    case 'fullscreen':
      window.setFullScreen(!window.isFullScreen());
      return;
    case 'about':
      await dialog.showMessageBox(window, {
        type: 'info',
        title: '关于知页 Paperleaf',
        message: '知页 Paperleaf ' + app.getVersion(),
        detail: '本地优先的文献阅读空间。启用 AI 后会将文字及支持时的页面图像发送给配置的服务。',
      });
      return;
    default:
      throw new Error('不支持的桌面操作');
  }
}
function installMenu(local) {
  Menu.setApplicationMenu(null);
  window.setMenuBarVisibility(false);
  ipcMain.handle('paperleaf:word', async (event, input) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !baseUrl ||
      new URL(event.senderFrame.url).origin !== baseUrl
    )
      throw new Error('拒绝非应用页面的 Word 操作');
    const script = app.isPackaged
      ? path.join(process.resourcesPath, 'desktop/word-bridge.ps1')
      : path.join(__dirname, 'word-bridge.ps1');
    return require('./word.cjs').runWord(input, script);
  });
  ipcMain.handle('paperleaf:desktop-action', async (event, action) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !baseUrl ||
      new URL(event.senderFrame.url).origin !== baseUrl
    )
      throw new Error('拒绝非应用页面的桌面操作');
    if (typeof action !== 'string') throw new Error('无效的操作');
    await desktopAction(action, local);
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    let action;
    if (input.control && !input.alt && input.key.toLowerCase() === 'o') action = 'import';
    if (input.control && !input.alt && input.key.toLowerCase() === 'f') action = 'find';
    if (input.key === 'F11') action = 'fullscreen';
    if (action) {
      event.preventDefault();
      void desktopAction(action, local);
    }
  });
}
async function createWindow() {
  const local = prepareProfile(profile);
  const logfile = path.join(profile, 'logs/desktop.log');
  if (fs.existsSync(logfile) && fs.statSync(logfile).size > 2 * 1024 * 1024)
    fs.renameSync(logfile, `${logfile}.previous`);
  bootLog = fs.createWriteStream(logfile, { flags: 'a' });
  log(
    `\n[${new Date().toISOString()}] Desktop ${app.getVersion()} starting, Node ${process.versions.node}\n`,
  );
  window = new BrowserWindow({
    width: 1400,
    height: 940,
    minWidth: 760,
    minHeight: 580,
    title: '知页 Paperleaf',
    backgroundColor: '#f9f8f4',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#edf1e9', symbolColor: '#35443a', height: 46 },
    show: false,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  installMenu(local);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!baseUrl || new URL(url).origin !== baseUrl) {
      event.preventDefault();
      openExternal(url);
    }
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(
      Boolean(
        baseUrl &&
        contents.getURL().startsWith(`${baseUrl}/`) &&
        permission === 'clipboard-sanitized-write',
      ),
    );
  });
  await window.loadFile(path.join(__dirname, 'loading.html'));
  window.show();
  try {
    const port = await availablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const serverRoot = app.isPackaged
      ? path.join(process.resourcesPath, 'server')
      : path.resolve(__dirname, '../.desktop-build/server');
    const bootstrap = app.isPackaged
      ? path.join(process.resourcesPath, 'desktop/server-bootstrap.cjs')
      : path.join(__dirname, 'server-bootstrap.cjs');
    // Run the bundled executable in its Node mode: PDF.js needs a genuine Node context,
    // whereas Electron utility processes are intentionally detected as renderers by PDF.js.
    backend = spawn(process.execPath, [bootstrap], {
      cwd: serverRoot,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        PAPERLEAF_SERVER_ROOT: serverRoot,
        PAPERLEAF_PROFILE: profile,
        ELECTRON_RUN_AS_NODE: '1',
      },
    });
    backend.stdout?.on('data', (data) => log(data.toString()));
    backend.stderr?.on('data', (data) => log(data.toString()));
    backend.on('exit', (code) => {
      backendExited = true;
      log(`[desktop] Server exited (${code})\n`);
      if (!quitting && baseUrl && window?.webContents.getURL().startsWith(baseUrl))
        void dialog.showMessageBox(window, {
          type: 'error',
          message: '本地服务已停止',
          detail: '已保存的数据仍在本机。请通过顶部“查看 → 重启应用”重新打开。',
        });
    });
    await ready(baseUrl);
    await window.loadURL(baseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知启动错误';
    log(`[desktop] ${message}\n`);
    await dialog.showMessageBox(window, {
      type: 'error',
      title: '知页启动失败',
      message,
      detail: `日志位置：${logfile}\n数据不会被删除。`,
    });
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(createWindow)
    .catch((error) => {
      dialog.showErrorBox('知页启动失败', error.message);
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting || !backend || backendExited) {
      bootLog?.end();
      return;
    }
    event.preventDefault();
    quitting = true;
    if (backend.connected) backend.send({ type: 'shutdown' });
    const timer = setTimeout(() => {
      backend?.kill();
      bootLog?.end();
      app.quit();
    }, 1800);
    backend.once('exit', () => {
      clearTimeout(timer);
      bootLog?.end();
      app.quit();
    });
  });
}
