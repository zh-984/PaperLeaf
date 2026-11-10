import { expect, test } from '@playwright/test';
import { makeDocx } from '../fixtures';
test('Work keeps most height for text and suggestions in both modes, details never push reading down', async ({
  page,
  request,
}) => {
  const base = 'http://127.0.0.1:3101';
  await request.patch(base + '/api/work/state', { data: { mode: 'work' } });
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(base);
  await page.getByLabel('上传 Work 稿件').setInputFiles({
    name: 'Compact manuscript.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await makeDocx(
      Array.from(
        { length: 18 },
        (_, i) =>
          `Paragraph ${i + 1}. This synthetic manuscript tests the available reading area and useful suggestions with a local simulator.`,
      ),
    ),
  });
  await expect(
    page.getByRole('heading', { name: 'Compact manuscript', exact: true }),
  ).toBeVisible();
  const list = await (await request.get(base + '/api/work')).json();
  const doc = list.find((item: { title: string }) => item.title === 'Compact manuscript');
  try {
    await page.getByRole('button', { name: '关闭 Work 提示' }).click();
    const grid = page.locator('.work-reading-grid');
    await expect(grid).toBeVisible();
    expect((await grid.boundingBox())!.height).toBeGreaterThan(490);
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await expect(page.locator('.work-results-summary')).toContainText('检查完成', {
      timeout: 60000,
    });
    expect((await grid.boundingBox())!.height).toBeGreaterThan(480);
    await expect(page.locator('.work-finding-list button')).toHaveCount(18);
    expect((await page.locator('.work-finding-list').boundingBox())!.height).toBeLessThanOrEqual(
      113,
    );
    const before = await grid.boundingBox();
    await page.getByRole('button', { name: '报告说明', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('报告范围与说明');
    expect((await grid.boundingBox())!.y).toBeCloseTo(before!.y, 0);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '公开来源查重' }).click();
    await page.getByLabel('检索开放论文').uncheck();
    await page.getByRole('button', { name: '开始查重', exact: true }).click();
    await expect(page.locator('.work-results-summary')).toContainText('没有取得来源');
    expect((await grid.boundingBox())!.height).toBeGreaterThan(480);
    await page.getByRole('button', { name: '报告说明', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('未取得可比对');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/work-compact.png' });
  } finally {
    await request.delete(base + '/api/work/' + doc.id);
    await request.patch(base + '/api/work/state', { data: { mode: 'read' } });
  }
});
