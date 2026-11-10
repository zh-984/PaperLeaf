import { expect, test } from '@playwright/test';
import { makeDocx } from '../fixtures';
test('Work displays true scientific subscript with a normal version suffix and concise metadata', async ({
  page,
  request,
}) => {
  const base = 'http://127.0.0.1:3100';
  await request.patch(base + '/api/work/state', { data: { mode: 'work' } });
  await page.goto(base);
  await page.getByLabel('上传 Work 稿件').setInputFiles({
    name: 'BiVO₄稿件4.1投稿版本.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await makeDocx(['A synthetic scientific title rendering fixture.']),
  });
  await expect(page.locator('.work-header h1')).toContainText('稿件4.1投稿版本');
  await expect(page.locator('.work-header h1 sub')).toHaveText('4');
  await expect(page.locator('.work-header h1 sub')).toHaveCount(1);
  await expect(page.locator('.work-header small')).toContainText('Word · 1 段');
  await expect(page.locator('.work-header small')).not.toContainText('投稿版本');
  const docs = await (await request.get(base + '/api/work')).json();
  const doc = docs.find((d: { fileName: string }) => d.fileName === 'BiVO₄稿件4.1投稿版本.docx');
  await request.delete(base + '/api/work/' + doc.id);
  await request.patch(base + '/api/work/state', { data: { mode: 'read' } });
});
