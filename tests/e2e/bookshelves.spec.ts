import { test, expect } from '@playwright/test';
import { makePdf } from '../fixtures';
const base = 'http://127.0.0.1:3100';
test('project shelves support upload targeting, collapse persistence, rename, move, search and safe deletion', async ({
  page,
  request,
}) => {
  for (const paper of await (await request.get(`${base}/api/papers`)).json())
    await request.delete(`${base}/api/papers/${paper.id}`);
  for (const shelf of await (await request.get(`${base}/api/bookshelves`)).json())
    await request.delete(`${base}/api/bookshelves/${shelf.id}`);
  await request.patch(`${base}/api/preferences`, {
    data: { defaultView: 'report', defaultShelfCollapsed: false },
  });
  await page.goto(base);
  await expect(page.getByText('放入你的第一篇文献')).toBeVisible();
  await page.getByLabel('上传 PDF 文件').setInputFiles({
    name: 'default.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Default Document'),
  });
  await expect(page.locator('main h1')).toHaveText('Default Document');
  await page.getByRole('button', { name: '新建书架', exact: true }).click();
  await page.getByLabel('书架名称').fill('实验项目');
  await page.getByRole('button', { name: '保存书架' }).click();
  await expect(page.locator('.upload-destination')).toHaveText('导入到：实验项目');
  await page.getByLabel('上传 PDF 文件').setInputFiles({
    name: 'project.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Project Document'),
  });
  await expect(page.locator('main h1')).toHaveText('Project Document');
  const id = new URL(page.url()).searchParams.get('paper')!,
    shelf = (await (await request.get(`${base}/api/bookshelves`)).json())[0],
    group = page.locator(`[data-shelf-id="${shelf.id}"]`);
  expect((await (await request.get(`${base}/api/papers/${id}`)).json()).shelfId).toBe(shelf.id);
  await group.locator('.bookshelf-name').click();
  await expect(group.locator('.shelf-item')).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get(`${base}/api/bookshelves`)).json())[0].collapsed)
    .toBe(true);
  await page.reload();
  await expect(group.locator('.bookshelf-name')).toHaveAttribute('aria-expanded', 'false');
  await group.locator('.bookshelf-name').click();
  await group.locator('summary[aria-label="Project Document 更多操作"]').click();
  await group.getByLabel('移动Project Document到书架').selectOption('');
  await expect
    .poll(async () => (await (await request.get(`${base}/api/papers/${id}`)).json()).shelfId)
    .toBeNull();
  await group.getByLabel('实验项目 书架操作').click();
  await group.getByRole('button', { name: '重命名书架' }).click();
  await page.getByLabel('书架名称').fill('电催化项目');
  await page.getByRole('button', { name: '保存书架' }).click();
  const defaultGroup = page.locator('[data-shelf-id="default"]');
  await defaultGroup.locator('summary[aria-label="Project Document 更多操作"]').click();
  await defaultGroup.getByLabel('移动Project Document到书架').selectOption(shelf.id);
  await expect(group.locator('.shelf-item')).toHaveCount(1);
  await group.getByLabel('电催化项目 书架操作').click();
  await group.getByRole('button', { name: '删除书架', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除书架', exact: true }).click();
  await expect(group).toHaveCount(0);
  await expect(defaultGroup.locator('.shelf-item')).toHaveCount(2);
  expect((await request.get(`${base}/api/papers/${id}/file`)).status()).toBe(200);
  await page.keyboard.press('Control+f');
  await expect(page.getByLabel('搜索书架文献')).toBeFocused();
  await page.getByLabel('搜索书架文献').fill('Project Document');
  await expect(page.locator('.shelf-item')).toHaveCount(1);
  await page.getByRole('button', { name: '清除书架搜索' }).click();
  await expect(page.locator('.shelf-item')).toHaveCount(2);
  await page.screenshot({ path: 'docs/images/bookshelves-0.4.png' });
});
test('split settings save reading preferences and the dismissible AI banner stays dismissed after refresh', async ({
  page,
  request,
}) => {
  await request.post(`${base}/api/settings`, {
    data: {
      baseUrl: 'http://127.0.0.1:4123/v1',
      model: 'test-simulator',
      apiKey: 'local-test-key',
    },
  });
  await request.patch(`${base}/api/preferences`, {
    data: { defaultView: 'report', showAiNotice: true, autoInterpret: false },
  });
  try {
    await page.goto(base);
    await expect(page.getByRole('button', { name: '关闭 AI 使用提示' })).toBeVisible();
    await page.getByRole('button', { name: '关闭 AI 使用提示' }).click();
    await expect(page.locator('.auto-privacy')).toHaveCount(0);
    await expect
      .poll(async () => (await (await request.get(`${base}/api/preferences`)).json()).showAiNotice)
      .toBe(false);
    await page.reload();
    await expect(page.locator('.workspace-loading')).toHaveCount(0);
    await expect(page.locator('.auto-privacy')).toHaveCount(0);
    await page.getByRole('button', { name: '设置与隐私', exact: true }).click();
    const dialog = page.getByRole('dialog'),
      nav = dialog.getByRole('navigation', { name: '设置分类' });
    await expect(nav.getByRole('button')).toHaveCount(6);
    await dialog.getByLabel('打开文献时显示').selectOption('original');
    await nav.getByRole('button', { name: '隐私与提示' }).click();
    await dialog.getByRole('switch', { name: '显示 AI 使用提示条' }).check();
    await nav.getByRole('button', { name: 'AI 配置', exact: true }).click();
    await expect(dialog.getByLabel('API 地址')).toBeVisible();
    await expect(dialog.getByLabel(/API Key/)).toHaveValue('');
    await page.screenshot({ path: 'docs/images/settings-0.4.png' });
    await nav.getByRole('button', { name: '阅读与外观' }).click();
    await dialog.getByRole('switch', { name: '减少动画' }).check();
    await dialog.getByRole('button', { name: '关闭设置' }).click();
    await expect(page.locator('.workspace')).toHaveClass(/reduced-motion/);
    await expect(page.locator('.auto-privacy')).toBeVisible();
    await expect
      .poll(async () => (await (await request.get(`${base}/api/preferences`)).json()).defaultView)
      .toBe('original');
    await page.reload();
    await expect(page.getByRole('tab', { name: /原文/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  } finally {
    await request.post(`${base}/api/settings`, {
      data: { baseUrl: 'http://127.0.0.1:4123/v1', model: 'test-simulator', clearKey: true },
    });
    await request.patch(`${base}/api/preferences`, {
      data: {
        defaultView: 'report',
        showAiNotice: true,
        autoInterpret: false,
        reduceMotion: false,
        readerFitWidth: true,
      },
    });
  }
});
