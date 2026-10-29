import { test, expect } from '@playwright/test';
import { makePdf } from '../fixtures';
const base = 'http://127.0.0.1:3100';
test('deleting a note or clearing a selected excerpt removes transient highlights', async ({
  page,
  request,
}) => {
  await request.patch(base + '/api/preferences', {
    data: { autoInterpret: false, defaultView: 'report' },
  });
  await page.goto(base);
  await expect(page.locator('.workspace-loading')).toHaveCount(0);
  await page.getByLabel('上传 PDF 文件').setInputFiles({
    name: 'highlight.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Highlight Cleanup'),
  });
  await expect(page.locator('main h1')).toHaveText('Highlight Cleanup');
  await expect(page.getByRole('button', { name: '导入文献', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: /原文/ }).click();
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  const span = page
    .getByTestId('pdf-text-layer')
    .locator('span')
    .filter({ hasText: 'The method uses a controlled experiment.' })
    .first();
  const select = async () => {
    await span.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await span.dispatchEvent('mouseup');
  };
  await select();
  await page.getByRole('toolbar').getByRole('button', { name: '记笔记', exact: true }).click();
  await expect(page.getByLabel('笔记内容')).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page
    .locator('.note-card')
    .getByRole('button', { name: /回到原文/ })
    .click();
  await expect(page.locator('.target-highlight').first()).toBeVisible();
  await page.locator('.note-card').getByRole('button', { name: '删除笔记' }).click();
  await expect(page.locator('.note-highlight,.target-highlight,.evidence-highlight')).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.locator('.workspace-loading')).toHaveCount(0);
  await expect(page.locator('main h1')).toHaveText('Highlight Cleanup');
  await page.getByRole('tab', { name: /原文/ }).click();
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  await select();
  await page.getByRole('toolbar').getByRole('button', { name: '追问', exact: true }).click();
  await expect(page.getByLabel('清除选中文字')).toBeVisible();
  await page.getByLabel('清除选中文字').click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await expect(page.locator('.note-highlight,.target-highlight,.evidence-highlight')).toHaveCount(
    0,
  );
});
