import { expect, test } from '@playwright/test';
import { makeDocx } from '../fixtures';
test('history identifies methods, scrolls after six rows, confirms deletion and isolates running spinners', async ({
  page,
  request,
}) => {
  const base = 'http://127.0.0.1:3100';
  await request.patch(base + '/api/work/state', { data: { mode: 'work' } });
  await page.goto(base);
  await page.getByLabel('上传 Work 稿件').setInputFiles({
    name: 'History controls.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await makeDocx(['Synthetic history controls document.']),
  });
  await expect(page.getByRole('heading', { name: 'History controls', exact: true })).toBeVisible();
  const list = await (await request.get(base + '/api/work')).json();
  const doc = list.find((d: { title: string }) => d.title === 'History controls');
  let tasks = Array.from({ length: 16 }, (_, i) => ({
    id: 'history' + i,
    kind: i < 8 ? 'aigc' : 'similarity',
    status: i === 0 ? 'running' : 'complete',
    results: {
      engine: i % 2 ? 'local' : 'assistant',
      model: i % 2 ? '中文本地模型' : 'Synthetic API',
    },
    progress: '测试历史',
    createdAt: new Date(2026, 10, 10, 12, 0, i).toISOString(),
    error: '',
  }));
  await page.route('**/api/work/' + doc.id, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ json: { ...data, tasks } });
  });
  await page.route('**/api/work/' + doc.id + '/tasks/*?remove=true', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    tasks = tasks.filter((t) => t.id !== id);
    await route.fulfill({ json: { ok: true } });
  });
  try {
    await page.reload();
    await expect(page.locator('.work-results-summary .spin')).toHaveCount(1);
    await page.locator('.work-history summary').click();
    await expect(page.getByLabel('Work 历史记录列表')).toContainText('AI 辅助分析');
    await expect(page.getByLabel('Work 历史记录列表')).toContainText('中文专用检测');
    const size = await page
      .getByLabel('Work 历史记录列表')
      .evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
    expect(size.height).toBeLessThanOrEqual(312);
    expect(size.scroll).toBeGreaterThan(size.height);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '公开来源查重' }).click();
    await expect(page.locator('.work-results-summary .spin')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
    await page.locator('.work-history summary').click();
    await page
      .getByRole('button', { name: /删除历史记录/ })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toContainText('删除历史记录和报告');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect(tasks).toHaveLength(16);
    await page.locator('.work-history summary').click();
    await page
      .getByRole('button', { name: /删除历史记录/ })
      .first()
      .click();
    await page.getByRole('button', { name: '确认删除记录和报告' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(tasks).toHaveLength(15);
  } finally {
    await request.delete(base + '/api/work/' + doc.id);
    await request.patch(base + '/api/work/state', { data: { mode: 'read' } });
  }
});
