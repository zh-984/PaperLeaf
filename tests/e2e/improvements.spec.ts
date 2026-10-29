import { openNotes } from '../ui-helpers';
import { test, expect } from '@playwright/test';
import { makePdf } from '../fixtures';

const base = 'http://127.0.0.1:3100';
test('compact numbered notes sort by source position, resize and renumber consistently', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await expect(page.locator('.workspace-loading')).toHaveCount(0);
  await page.getByLabel('上传 PDF 文件').setInputFiles({
    name: 'note-order.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Note Order', 3),
  });
  await expect(page.locator('main h1')).toHaveText('Note Order');
  const id = new URL(page.url()).searchParams.get('paper')!;
  for (const [content, y] of [
    ['先创建，在下面', 0.7],
    ['后创建，在上面', 0.1],
  ] as const) {
    const response = await request.post(`${base}/api/papers/${id}/notes`, {
      data: {
        content,
        selectedText: '不要在右侧重复显示的原句',
        page: 2,
        anchor: { version: 1, locations: [{ page: 2, rects: [[0.12, y, 0.4, 0.03]] }] },
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.reload();
  await openNotes(page);
  await page.getByRole('button', { name: '全部 2', exact: true }).click();
  await expect(page.getByLabel('笔记内容').nth(0)).toHaveValue('后创建，在上面');
  await expect(page.getByLabel('笔记内容').nth(1)).toHaveValue('先创建，在下面');
  await expect(page.locator('.note-number')).toHaveText(['（1）', '（2）']);
  await expect(page.locator('.note-card blockquote')).toHaveCount(0);
  expect(
    await page.locator('.side-panel').evaluate((element) => element.getBoundingClientRect().width),
  ).toBe(320);
  expect(
    await page
      .getByLabel('笔记内容')
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  await page.getByRole('separator', { name: '调整笔记面板宽度' }).press('ArrowLeft');
  expect(
    await page.locator('.side-panel').evaluate((element) => element.getBoundingClientRect().width),
  ).toBe(340);
  await page
    .locator('.note-card')
    .first()
    .getByRole('button', { name: /回到原文/ })
    .click();
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  await expect(page.locator('.pdf-page[data-page="2"] .page-note-marker')).toHaveText([
    '（1）',
    '（2）',
  ]);
  await page.getByLabel('笔记内容').first().fill('换行时自动增高。'.repeat(35));
  await expect
    .poll(async () =>
      page
        .getByLabel('笔记内容')
        .first()
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeGreaterThan(100);
  await expect(
    page.locator('.note-card').first().getByText('已保存到本机', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/numbered-notes.png' });
  await page.locator('.note-card').first().getByRole('button', { name: '删除笔记' }).click();
  await expect(page.locator('.note-number')).toHaveText(['（1）']);
  await expect(page.locator('.pdf-page[data-page="2"] .page-note-marker')).toHaveText(['（1）']);
});
test('AI configuration needs only API details and model, with immediate application and hidden key', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await expect(page.locator('.workspace-loading')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('paperleaf:open-settings')));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('API 地址').fill('http://127.0.0.1:4123/v1/chat/completions');
  await dialog.getByLabel(/API Key/).fill('local-test-key-not-a-real-secret');
  await dialog.getByLabel('模型名称').fill('test-simulator');
  await dialog.getByRole('button', { name: '保存 AI 配置' }).click();
  await expect(dialog.getByText('已保存，立即生效。配置 1 用于整篇解读和追问。')).toBeVisible();
  const config = await (await request.get(`${base}/api/settings`)).json();
  expect(config.aiEnabled).toBe(true);
  expect(JSON.stringify(config)).not.toContain('local-test-key');
  await expect(dialog.getByLabel(/API Key/)).toHaveValue('');
  await dialog.getByRole('button', { name: '移除 Key' }).click();
  await expect(dialog.getByText('AI 已关闭，阅读与笔记仍可使用。')).toBeVisible();
  expect((await (await request.get(`${base}/api/settings`)).json()).aiEnabled).toBe(false);
});

test('continuous scrolling, anchored notes, zoom-safe highlights and exact reading restoration', async ({
  page,
  request,
}) => {
  for (const paper of await (await request.get(`${base}/api/papers`)).json())
    await request.delete(`${base}/api/papers/${paper.id}`);
  await page.goto(base);
  await page.getByLabel('上传 PDF 文件').setInputFiles({
    name: '连续阅读中文标题.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Continuous Reading', 12),
  });
  await expect(page.locator('main h1')).toHaveText('Continuous Reading');
  const id = new URL(page.url()).searchParams.get('paper')!;
  await page.getByRole('tab', { name: /原文/ }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(12);
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  async function scrollTo(number: number, fraction: number) {
    await page.locator('.pdf-scroll').evaluate(
      (root, args) => {
        const element = root.querySelector<HTMLElement>(`.pdf-page[data-page="${args.number}"]`)!;
        root.scrollTop = element.offsetTop + element.offsetHeight * args.fraction;
      },
      { number, fraction },
    );
    await expect(page.getByLabel('页码', { exact: true })).toHaveValue(String(number));
  }
  await scrollTo(2, 0.12);
  const span = page
    .locator('.pdf-page[data-page="2"].ready .textLayer span')
    .filter({ hasText: 'The method uses a controlled experiment.' })
    .first();
  await expect(span).toBeVisible();
  await span.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await span.dispatchEvent('mouseup');
  await page.getByRole('toolbar').getByRole('button', { name: '记笔记', exact: true }).click();
  await page.getByLabel('笔记内容').fill('原句对应的理解：需要对照组。');
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  const detail = await (await request.get(`${base}/api/papers/${id}`)).json();
  expect(detail.fileName).toBe('连续阅读中文标题.pdf');
  expect(detail.notes[0].anchor.locations[0].page).toBe(2);
  expect(detail.notes[0].anchor.locations[0].rects.length).toBeGreaterThan(0);
  await expect(page.locator('.pdf-page[data-page="2"] .note-highlight').first()).toBeVisible();
  await scrollTo(4, 0.2);
  await expect(page.getByRole('button', { name: '本页 0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /p\.2 · 回到原文/ }).click();
  await expect(page.getByLabel('页码', { exact: true })).toHaveValue('2');
  await expect(page.locator('.target-highlight').first()).toBeVisible();
  const before = await page
    .locator('.target-highlight')
    .first()
    .evaluate((element) => parseFloat((element as HTMLElement).style.left));
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  expect(
    await page
      .locator('.target-highlight')
      .first()
      .evaluate((element) => parseFloat((element as HTMLElement).style.left)),
  ).toBe(before);
  await page.getByRole('button', { name: '适应宽度' }).click();
  await page.getByRole('button', { name: '收起追问面板' }).click();
  await scrollTo(8, 0.4);
  await expect
    .poll(async () => (await (await request.get(`${base}/api/papers/${id}`)).json()).lastPosition)
    .toBeCloseTo(0.4, 1);
  await page.reload();
  await page.getByRole('tab', { name: /原文/ }).click();
  await expect(page.getByTestId('pdf-page')).toHaveAttribute('data-page', '8');
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  const restored = await page.locator('.pdf-scroll').evaluate((root) => {
    const element = root.querySelector<HTMLElement>('.pdf-page[data-page="8"]')!;
    return (root.scrollTop - element.offsetTop) / element.offsetHeight;
  });
  expect(restored).toBeCloseTo(0.4, 1);
  expect(await page.locator('.pdf-page.ready').count()).toBeLessThan(12);
  await openNotes(page);
  await page.getByRole('button', { name: '全部 1', exact: true }).click();
  await expect(page.getByLabel('笔记内容')).toHaveValue('原句对应的理解：需要对照组。');
  await page.screenshot({ path: 'test-results/screenshots/continuous-notes.png' });
});
