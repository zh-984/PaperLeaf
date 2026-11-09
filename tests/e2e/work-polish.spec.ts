import { expect, test } from '@playwright/test';
import { makeDocx } from '../fixtures';
test('switching retains the current page until ready, preserves state and uses compact document dialogs', async ({
  page,
  request,
}) => {
  const base = 'http://127.0.0.1:3100';
  const preferences = await (await request.get(base + '/api/preferences')).json();
  await request.patch(base + '/api/preferences', { data: { theme: 'blue' } });
  await request.patch(base + '/api/work/state', { data: { mode: 'read' } });
  await page.goto(base);
  const search = page.getByRole('textbox', { name: '搜索书架文献' });
  await search.fill('保留我的搜索');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'blue');
  await page.route('**/api/work', async (route) => {
    if (route.request().method() === 'GET')
      await new Promise((resolve) => setTimeout(resolve, 650));
    await route.continue();
  });
  await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
  await page.getByRole('menuitemradio', { name: /PaperLeaf Work/ }).click();
  const stable = await page.evaluate(async () => {
    const frames: boolean[] = [];
    const start = performance.now();
    while (performance.now() - start < 350) {
      frames.push(
        document.documentElement.dataset.theme === 'blue' &&
          !!document.querySelector('.mode-pane[data-current="true"] .project-shelf'),
      );
      await new Promise(requestAnimationFrame);
    }
    return frames.every(Boolean) && frames.length > 0;
  });
  expect(stable).toBe(true);
  await expect(page.locator('.mode-pane[data-current="true"] .work-shelf')).toBeVisible();
  await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
  await page.getByRole('menuitemradio', { name: /PaperLeaf Read/ }).click();
  await expect(search).toBeVisible();
  await expect(search).toHaveValue('保留我的搜索');
  await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
  await page.getByRole('menuitemradio', { name: /PaperLeaf Work/ }).click();
  await expect(page.locator('.mode-pane[data-current="true"] .work-shelf')).toBeVisible();
  const upload = page.waitForResponse(
    (r) => r.url().endsWith('/api/work') && r.request().method() === 'POST',
  );
  await page.getByLabel('上传 Work 稿件').setInputFiles({
    name: 'dialog-layout.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await makeDocx([
      '第一段测试正文，保留正常字号。',
      '第二段测试正文，段间空白应更紧凑。',
      '第三段测试正文，不调用任何 AI。',
    ]),
  });
  const doc = await (await upload).json();
  try {
    await expect(page.getByRole('heading', { level: 1, name: 'dialog-layout' })).toBeVisible();
    const gap = await page.locator('.work-text').evaluate((root) => {
      const paragraphs = root.querySelectorAll('.work-paragraph');
      return (
        paragraphs[1].querySelector('button')!.getBoundingClientRect().top -
        paragraphs[0].querySelector('p')!.getBoundingClientRect().bottom
      );
    });
    expect(gap).toBeLessThanOrEqual(32);
    await page.getByTitle('重命名稿件').click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeVisible();
    await dialog.getByLabel('稿件标题').fill('新的标题');
    await page.screenshot({ path: 'test-results/work-rename-dialog.png' });
    await dialog.getByRole('button', { name: '保存标题' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '新的标题' })).toBeVisible();
    await page.getByRole('button', { name: '删除 Work 稿件', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('新的标题', { exact: true })).toBeVisible();
    const cancel = await dialog.getByRole('button', { name: '取消', exact: true }).boundingBox(),
      confirm = await dialog.getByRole('button', { name: '确认删除稿件' }).boundingBox();
    expect(cancel!.y).toBeCloseTo(confirm!.y, 0);
    expect(cancel!.x).toBeLessThan(confirm!.x);
    await page.screenshot({ path: 'test-results/work-delete-dialog.png' });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect((await request.get(base + '/api/work/' + doc.id)).ok()).toBe(true);
  } finally {
    await request.delete(base + '/api/work/' + doc.id);
    await request.patch(base + '/api/preferences', { data: { theme: preferences.theme } });
    await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
    await page.getByRole('menuitemradio', { name: /PaperLeaf Read/ }).click();
    await expect(page.locator('.mode-pane[data-current="true"] .project-shelf')).toBeVisible();
  }
});
