import { expect, test } from '@playwright/test';
import { makeDocx, makePdf } from '../fixtures';
const base = 'http://127.0.0.1:3101';
test('Work mode imports, analyzes, locates, persists, configures detectors and deletes safely', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
  await page.getByRole('menuitemradio', { name: /PaperLeaf Work/ }).click();
  const file = await makeDocx([
    '摘要',
    'This synthetic manuscript tests the PaperLeaf Work workflow with explicit document paragraphs.',
    'A controlled experiment compares reading conditions and reports the evidence with appropriate limitations.',
  ]);
  await page.getByLabel('上传 Work 稿件').setInputFiles({
    name: 'work-demo.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: file,
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('work-demo');
  const list = await (await request.get(base + '/api/work')).json();
  const id = list.find((item: { title: string }) => item.title === 'work-demo').id;
  try {
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await expect(page.locator('.work-results-summary')).toContainText('检查完成', {
      timeout: 60000,
    });
    await expect(page.locator('.work-text mark').first()).toBeVisible();
    await expect(page.locator('.work-findings')).toContainText('补充研究条件');
    await page.screenshot({ path: 'test-results/work-view.png' });
    const before = await (await request.get(base + '/api/work/' + id)).json();
    expect(before.tasks[0].results.engine).toBe('assistant');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('work-demo');
    await expect(page.locator('.work-results-summary')).toContainText('检查完成');
    await page.getByRole('tab', { name: '公开来源查重' }).click();
    await page.getByLabel('检索开放论文').uncheck();
    await page.getByRole('button', { name: '开始查重', exact: true }).click();
    await expect(page.locator('.work-results-summary')).toContainText('没有取得来源');
    const detail = await (await request.get(base + '/api/work/' + id)).json();
    expect(
      detail.tasks.find((task: { kind: string }) => task.kind === 'similarity').results.percentage,
    ).toBeNull();
    await page.getByRole('tab', { name: 'AIGC 分析' }).click();
    await page.getByText('专用检测器接入（可选）').click();
    await page.getByLabel('检测器接口地址').fill('http://127.0.0.1:4123/detect');
    await page.getByLabel('检测模型名称').fill('synthetic-detector');
    await page.getByLabel('检测器 API Key').fill('private-detector-test-key');
    await page.getByRole('button', { name: '保存检测器配置' }).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    const capabilities = await (await request.get(base + '/api/work/capabilities')).json();
    expect(JSON.stringify(capabilities)).not.toContain('private-detector-test-key');
    expect(capabilities.detectorUrl).toBe('http://127.0.0.1:4123/detect');
    await expect(page.getByLabel('检测器接口地址')).toHaveValue(capabilities.detectorUrl);
    await page.getByLabel('检测方式').selectOption('detector');
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await expect(page.locator('.work-results-summary')).toContainText('检查完成', {
      timeout: 60000,
    });
    await expect(page.locator('.work-findings')).toContainText('模型评分 85.0%');
    await page.getByRole('button', { name: '删除 Work 稿件', exact: true }).click();
    await page.getByRole('button', { name: '确认删除稿件' }).click();
    await expect(page.getByRole('heading', { name: 'work-demo', exact: true })).toHaveCount(0);
    const pdf = await makePdf('Work PDF', 1);
    await page
      .getByLabel('上传 Work 稿件')
      .setInputFiles({ name: 'work-original.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('work-original');
    const pdfList = await (await request.get(base + '/api/work')).json();
    const pdfId = pdfList.find((item: { title: string }) => item.title === 'work-original').id;
    await request.delete(base + '/api/work/' + pdfId);
    await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
    await page.getByRole('menuitemradio', { name: /PaperLeaf Read/ }).click();
    await expect(page.getByRole('button', { name: '导入文献' })).toBeVisible();
  } finally {
    await request.delete(base + '/api/work/' + id);
    await request.patch(base + '/api/work/detector-settings', {
      data: { url: '', model: '', clearKey: true },
    });
  }
});
