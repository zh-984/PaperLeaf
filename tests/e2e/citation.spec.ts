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
    await page.addInitScript(() => {
      window.paperleafDesktop = {
        action: async () => {},
        word: async (input) => {
          localStorage.setItem('word-test-input', JSON.stringify(input));
          return { citations: 1, references: 1 };
        },
      };
    });
    await page.goto(`${base}/?paper=${paper.id}`);
    await page.getByRole('tab', { name: '文献引用' }).click();
    await expect(page.getByLabel('文献标题')).toHaveValue('Reference Demo');
    await page.getByLabel('作者', { exact: true }).fill('Manual Author');
    await page.getByLabel('文中标号', { exact: true }).fill('({{number}})');
    await page.getByLabel('文末参考文献缩进').selectOption('hanging');
    await page.getByLabel('缩进字符数').fill('1.5');
    await expect(page.locator('.citation-preview sup')).toHaveText('(1)');
    await page.getByText('格式字段对照表（点击展开）').click();
    await expect(page.getByRole('cell', { name: '{{authors}}', exact: true })).toBeVisible();
    if (process.env.PAPERLEAF_CAPTURE)
      await page.screenshot({ path: 'test-results/citation-view.png' });
    await page.getByRole('button', { name: '保存引用信息' }).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    await page.reload();
    await page.getByRole('tab', { name: '文献引用' }).click();
    await expect(page.getByLabel('作者', { exact: true })).toHaveValue('Manual Author');
    await expect(page.getByLabel('文中标号', { exact: true })).toHaveValue('({{number}})');
    await expect(page.getByLabel('文末参考文献缩进')).toHaveValue('hanging');
    await expect(page.getByLabel('缩进字符数')).toHaveValue('1.5');
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
    await page.getByRole('button', { name: '插入到 Word', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Word 已更新');
    const sent = await page.evaluate(() => JSON.parse(localStorage.getItem('word-test-input')!));
    expect(sent.action).toBe('insert');
    expect(sent.reference.paperId).toBe(paper.id);
    expect(sent.settings.markerTemplate).toBe('({{number}})');
    expect(sent.settings.markerSuperscript).toBe(true);
    expect(sent.settings.bibliographyIndent).toBe('hanging');
    expect(sent.settings.indentCharacters).toBe(1.5);
  } finally {
    await request.delete(`${base}/api/papers/${paper.id}`);
  }
});
