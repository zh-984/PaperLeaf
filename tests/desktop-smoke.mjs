import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { access, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);
const testRoot = path.resolve('.test-data/desktop-e2e');
await mkdir(testRoot, { recursive: true });
const profile = await mkdtemp(path.join(testRoot, 'profile-'));
const packagedExe =
  process.env.DESKTOP_EXECUTABLE || path.resolve('release/win-unpacked/Paperleaf.exe');
const sourceMode = process.argv.includes('--source');
const executablePath = sourceMode ? require('electron') : packagedExe;
if (!sourceMode) await access(executablePath);
let desktop;
let previousUrl;
let mockServer;
async function launch() {
  const instance = await electron.launch({
    executablePath,
    args: sourceMode ? [path.resolve('desktop/main.cjs')] : [],
    env: {
      ...process.env,
      PAPERLEAF_DESKTOP_TEST: '1',
      PAPERLEAF_TEST_PROFILE: profile,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    timeout: 60000,
  });
  const window = await instance.firstWindow();
  try {
    await window.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
  } catch (error) {
    console.error(
      await readFile(path.join(profile, 'logs/desktop.log'), 'utf8').catch(() => 'No startup log'),
    );
    await instance.close();
    throw error;
  }
  const prefs = await instance.evaluate(({ BrowserWindow, app }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      packaged: app.isPackaged,
      nodeIntegration: preferences.nodeIntegration,
      contextIsolation: preferences.contextIsolation,
      sandbox: preferences.sandbox,
    };
  });
  expect(prefs).toMatchObject({
    packaged: !sourceMode,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  });
  return { instance, window };
}
try {
  let launched = await launch();
  desktop = launched.instance;
  let window = launched.window;
  await expect(window.getByText('放入你的第一篇文献')).toBeVisible();
  const settings = await window.evaluate(async () => (await fetch('/api/settings')).json());
  expect(settings.desktopMode).toBe(true);
  expect(settings.aiEnabled).toBe(false);
  expect(
    await window.evaluate(
      async () => (await (await fetch('/api/preferences')).json()).autoInterpret,
    ),
  ).toBe(false);
  expect(await window.evaluate(() => typeof window.require)).toBe('undefined');
  const uploadResponse = window.waitForResponse(
    (response) => response.url().endsWith('/api/papers') && response.request().method() === 'POST',
  );
  void uploadResponse.catch(() => undefined);
  const nativeChooser = window.waitForEvent('filechooser', { timeout: 10000 });
  await expect(window.getByRole('menubar', { name: '应用菜单' })).toBeVisible();
  await expect(window.locator('.desktop-window-title')).toHaveCount(0);
  await expect(window.locator('.workspace-header .notes-shortcut')).toHaveCount(0);
  await window.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await window
    .getByRole('menu', { name: '文件', exact: true })
    .getByRole('menuitem', { name: /导入 PDF/ })
    .click();
  await (await nativeChooser).setFiles(path.resolve('examples/sample-paper.pdf'));
  const uploaded = await uploadResponse;
  if (!uploaded.ok())
    throw new Error(`Desktop PDF upload failed (${uploaded.status()}): ${await uploaded.text()}`);
  await expect(window.locator('main h1')).toHaveText('Paperleaf Synthetic Demo');
  await window.getByRole('tab', { name: '文献引用' }).click();
  await window.getByLabel('作者', { exact: true }).fill('Desktop Test Author');
  await window.getByRole('button', { name: '保存引用信息' }).click();
  await expect(window.locator('.citation-document').getByRole('status')).toContainText('已保存');
  await window.getByRole('tab', { name: /原文/ }).click();
  await expect(window.getByTestId('pdf-page')).toHaveClass(/ready/, { timeout: 30000 });
  await window.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(window.getByTestId('pdf-page')).toHaveAttribute('data-page', '2');
  await expect(window.getByTestId('pdf-page')).toHaveClass(/ready/);
  if (!(await window.locator('.side-panel').count()))
    await window.getByRole('button', { name: '打开追问面板', exact: true }).click();
  await window.locator('.side-panel').getByRole('button', { name: /^笔记/ }).click();
  await window.getByRole('button', { name: '新建笔记' }).click();
  await window.getByLabel('笔记内容').fill('桌面版测试：关闭程序后仍应保留。');
  await expect(window.getByText('已保存到本机', { exact: true })).toBeVisible();
  const saved = await window.evaluate(async () => {
    const [paper] = await (await fetch('/api/papers')).json();
    return (await fetch(`/api/papers/${paper.id}`)).json();
  });
  expect(saved.notes[0].content).toContain('关闭程序后仍应保留');
  expect(saved.lastPage).toBe(2);
  await window.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await window
    .getByRole('menu', { name: '文件' })
    .getByRole('menuitem', { name: '新建书架', exact: true })
    .click();
  await window.getByLabel('书架名称').fill('桌面项目');
  await window.getByRole('button', { name: '保存书架' }).click();
  const groups = await window.evaluate(async () => (await fetch('/api/bookshelves')).json());
  const projectId = groups[0].id;
  await window.locator('summary[aria-label="Paperleaf Synthetic Demo 更多操作"]').click();
  await window.getByLabel('移动Paperleaf Synthetic Demo到书架').selectOption(projectId);
  await expect(window.locator(`[data-shelf-id="${projectId}"] .shelf-item`)).toHaveCount(1);
  await window.locator(`[data-shelf-id="${projectId}"] .bookshelf-name`).click();
  await expect
    .poll(() =>
      window.evaluate(async () => (await (await fetch('/api/bookshelves')).json())[0].collapsed),
    )
    .toBe(true);
  await expect(window.getByTestId('pdf-page')).toHaveClass(/ready/);
  previousUrl = new URL(window.url()).origin;
  await mkdir('docs/images', { recursive: true });
  await window.screenshot({ path: 'docs/images/desktop.png' });
  await desktop.close();
  desktop = undefined;
  await expect
    .poll(async () => {
      try {
        await fetch(`${previousUrl}/api/settings`, { signal: AbortSignal.timeout(500) });
        return false;
      } catch {
        return true;
      }
    })
    .toBe(true);
  launched = await launch();
  desktop = launched.instance;
  window = launched.window;
  await expect(window.locator('main h1')).toHaveText('Paperleaf Synthetic Demo');
  await window.getByRole('tab', { name: '文献引用' }).click();
  await expect(window.getByLabel('作者', { exact: true })).toHaveValue('Desktop Test Author');
  await window.getByRole('tab', { name: /原文/ }).click();
  await expect(window.getByTestId('pdf-page')).toHaveAttribute('data-page', '2');
  await expect(window.getByTestId('pdf-page')).toHaveClass(/ready/);
  if (!(await window.locator('.side-panel').count()))
    await window.getByRole('button', { name: '打开追问面板', exact: true }).click();
  await window.locator('.side-panel').getByRole('button', { name: /^笔记/ }).click();
  await expect(window.getByLabel('笔记内容')).toHaveValue('桌面版测试：关闭程序后仍应保留。');
  const menuState = await desktop.evaluate(({ Menu, BrowserWindow }) => ({
    menu: Menu.getApplicationMenu(),
    visible: BrowserWindow.getAllWindows()[0].isMenuBarVisible(),
  }));
  expect(menuState.menu).toBeNull();
  expect(menuState.visible).toBe(false);
  await expect(window.getByRole('menubar').getByRole('menuitem')).toHaveText([
    '文件',
    '编辑',
    '查看',
    '帮助',
  ]);
  expect(await window.evaluate(() => navigator.windowControlsOverlay?.visible)).toBe(true);
  await expect(window.locator(`[data-shelf-id="${projectId}"] .bookshelf-name`)).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await window.getByRole('button', { name: '设置与隐私', exact: true }).click();
  const settingsDialog = window.getByRole('dialog');
  await expect(
    settingsDialog.getByRole('navigation', { name: '设置分类' }).getByRole('button'),
  ).toHaveCount(6);
  await settingsDialog.getByRole('button', { name: 'AI 配置', exact: true }).click();
  await expect(settingsDialog.getByLabel('API 地址')).toBeVisible();
  await expect(settingsDialog.getByLabel('模型名称')).toBeVisible();
  await settingsDialog.getByRole('button', { name: '阅读与外观', exact: true }).click();
  await settingsDialog.getByRole('radio', { name: '浅蓝色', exact: true }).check();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'blue');
  await expect(window.locator('.desktop-titlebar')).toHaveCSS(
    'background-color',
    'rgb(234, 242, 251)',
  );
  await window.screenshot({ path: 'docs/images/settings-desktop-0.4.png' });
  expect(
    await window.evaluate(async () => {
      try {
        await window.paperleafDesktop.action('__invalid__');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await settingsDialog.getByRole('button', { name: '关闭设置' }).click();
  await window.getByRole('menubar').getByRole('menuitem', { name: '查看', exact: true }).click();
  await window
    .getByRole('menu', { name: '查看', exact: true })
    .getByRole('menuitem', { name: '放大界面', exact: true })
    .click();
  expect(
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
    ),
  ).toBeCloseTo(1.1);
  await window.locator('.pdf-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await window.mouse.move(50, 200);
  await window.mouse.wheel(0, 1500);
  const layout = await window.evaluate(() => ({
    height: innerHeight,
    body: document.documentElement.scrollHeight,
    bottom: document.querySelector('.shelf').getBoundingClientRect().bottom,
    top: document.querySelector('.workspace').getBoundingClientRect().top,
    titleBottom: document.querySelector('.desktop-titlebar').getBoundingClientRect().bottom,
  }));
  expect(layout.body).toBeLessThanOrEqual(layout.height + 1);
  expect(layout.bottom).toBeCloseTo(layout.height, 0);
  expect(layout.top).toBeCloseTo(layout.titleBottom, 0);
  await window.getByRole('menubar').getByRole('menuitem', { name: '查看', exact: true }).click();
  await window
    .getByRole('menu', { name: '查看', exact: true })
    .getByRole('menuitem', { name: '恢复界面缩放', exact: true })
    .click();
  let visualImages = 0;
  mockServer = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw),
      system = body.messages[0].content,
      key = system.match(/REPORT_SECTION (\w+)/)?.[1];
    visualImages += body.messages.reduce(
      (count, message) =>
        count +
        (Array.isArray(message.content)
          ? message.content.filter((part) => part.type === 'image_url').length
          : 0),
      0,
    );
    const content = key
      ? JSON.stringify({
          conclusion: '本机模拟报告',
          points: Array.from({ length: key === 'terms' ? 5 : key === 'questions' ? 3 : 2 }, () => ({
            text: '依据原文核对，不确定时保留判断。',
            page: 2,
            quote: 'The method uses a controlled experiment.',
          })),
        })
      : '[p.2] 原文使用对照实验，样本推广能力不确定。';
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { total_tokens: 42 },
      }),
    );
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const address = mockServer.address();
  await window.evaluate(async (url) => {
    const configured = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: url,
        model: 'GLM-5.3-Flash',
        apiKey: 'local-desktop-test-key',
      }),
    });
    if (!configured.ok) throw new Error('Cannot configure local test model');
    const [paper] = await (await fetch('/api/papers')).json();
    const started = await fetch(`/api/ai/report/${paper.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false }),
    });
    if (!started.ok) throw new Error('Cannot start desktop vision report');
  }, `http://127.0.0.1:${address.port}/v1`);
  await expect
    .poll(
      () =>
        window.evaluate(async () => {
          const [paper] = await (await fetch('/api/papers')).json();
          return paper.report.status;
        }),
      { timeout: 30000 },
    )
    .toBe('complete');
  expect(visualImages).toBe(3);
  const resources = await desktop.evaluate(() => process.resourcesPath);
  if (!sourceMode) {
    const files = await readdir(path.join(resources, 'server'));
    expect(files).not.toContain('.env');
    expect(files).not.toContain('data');
    expect(files).not.toContain('library.db');
  }
  console.log(
    `PASS: ${sourceMode ? 'source' : 'packaged EXE'} desktop startup, sandbox, upload, PDF canvas/text layer, page memory, autosave, full app restart, clean shutdown, integrated titlebar menus, split settings, project shelf persistence, safe preload, zoom and 3-page multimodal report.`,
  );
} catch (error) {
  console.error(
    await readFile(path.join(profile, 'logs/desktop.log'), 'utf8').catch(() => 'No desktop log'),
  );
  throw error;
} finally {
  if (desktop) await desktop.close();
  if (mockServer) {
    mockServer.closeAllConnections();
    await new Promise((resolve) => mockServer.close(resolve));
  }
}
