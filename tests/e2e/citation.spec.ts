import { expect, test } from '@playwright/test';
import { makePdf } from '../fixtures';
const base = 'http://127.0.0.1:3101';

test('reference data, editable templates and manual AI suggestions are safe and persistent', async ({
  page,
  request,
}) => {
  await request.patch(`${base}/api/preferences`, { data: { autoInterpret: false } });
  const response = await request.post(`${base}/api/papers`, {
    multipart: {
      file: {
        name: 'citation.pdf',
        mimeType: 'application/pdf',
        buffer: await makePdf('Reference Demo', 3),
      },
    },
  });
  expect(response.ok()).toBe(true);
  const paper = await response.json();
  try {
    await page.goto(`${base}/?paper=${paper.id}`);
    await page.getByRole('tab', { name: '文献引用' }).click();
    await expect(page.getByLabel('文献标题')).toHaveValue('Reference Demo');
    await page.getByLabel('作者', { exact: true }).fill('Manual Author');
    await page.getByLabel('文中标号').fill('({{number}})');
    if (process.env.PAPERLEAF_CAPTURE)
      await page.screenshot({ path: 'test-results/citation-view.png' });
    await page.getByRole('button', { name: '保存引用信息' }).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    await page.reload();
    await page.getByRole('tab', { name: '文献引用' }).click();
    await expect(page.getByLabel('作者', { exact: true })).toHaveValue('Manual Author');
    await expect(page.getByLabel('文中标号')).toHaveValue('({{number}})');
    await page.getByRole('button', { name: 'AI 识别书目信息' }).click();
    await expect(page.getByRole('status')).toContainText('请逐项核对');
    await expect(page.getByLabel('作者', { exact: true })).toHaveValue('Manual Author');
    await expect(page.getByLabel('年份')).toHaveValue('2025');
    expect(
      (await (await request.get(`${base}/api/papers/${paper.id}/reference`)).json()).year,
    ).toBe('');
    await page.getByRole('button', { name: '保存引用信息' }).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    expect(
      (await (await request.get(`${base}/api/papers/${paper.id}/reference`)).json()).year,
    ).toBe('2025');
  } finally {
    await request.delete(`${base}/api/papers/${paper.id}`);
  }
});
