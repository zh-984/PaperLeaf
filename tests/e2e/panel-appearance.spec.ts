import { test, expect } from '@playwright/test';
import { makePdf } from '../fixtures';
const base = 'http://127.0.0.1:3100';
test('white headers, themed chat areas, a single panel toggle and identical panel widths', async ({
  page,
  request,
}) => {
  await request.patch(`${base}/api/preferences`, {
    data: { theme: 'green', defaultView: 'report', autoInterpret: false },
  });
  await page.goto(base);
  await expect(page.locator('.workspace-loading')).toHaveCount(0);
  await page.getByLabel('上传 PDF 文件').setInputFiles({
    name: 'panel.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Panel Layout', 20),
  });
  await expect(page.locator('main h1')).toHaveText('Panel Layout');
  await expect(page.locator('.header-actions .notes-shortcut')).toHaveCount(0);
  await page.getByRole('button', { name: '打开追问面板', exact: true }).click();
  const panel = page.locator('.side-panel');
  const width = () => panel.evaluate((el) => el.getBoundingClientRect().width);
  const tabBounds = () =>
    panel.locator('.panel-header > div > button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
  expect(await width()).toBe(320);
  const initialTabBounds = await tabBounds();
  await panel.getByRole('button', { name: /^笔记/ }).click();
  expect(await width()).toBe(320);
  expect(await tabBounds()).toEqual(initialTabBounds);
  await page.getByRole('separator', { name: '调整笔记面板宽度' }).press('ArrowLeft');
  expect(await width()).toBe(340);
  await panel.getByRole('button', { name: 'AI 追问', exact: true }).click();
  expect(await width()).toBe(340);
  const resizedTabBounds = await tabBounds();
  await panel.getByRole('button', { name: /^笔记/ }).click();
  expect(await tabBounds()).toEqual(resizedTabBounds);
  await panel.getByRole('button', { name: 'AI 追问', exact: true }).click();
  await page.getByRole('tab', { name: /原文/ }).click();
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  await page.getByRole('button', { name: '设置与隐私', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '阅读与外观', exact: true }).click();
  for (const [theme, color] of [
    ['浅蓝色', 'rgb(234, 242, 251)'],
    ['浅黄色', 'rgb(250, 243, 220)'],
    ['纯白色', 'rgb(255, 255, 255)'],
    ['浅绿色', 'rgb(237, 241, 233)'],
  ] as const) {
    await dialog.getByRole('radio', { name: theme, exact: true }).check();
    for (const selector of [
      '.workspace-header',
      '.document-tabs',
      '.panel-header',
      '.chat-context',
      '.reader-toolbar',
      '.chat-history > .panel-empty',
    ])
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    for (const selector of ['.chat-empty-icon', '.suggestions button', '.chat-compose'])
      await expect(page.locator(selector).first()).toHaveCSS('background-color', color);
  }
  await dialog.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '收起追问面板' }).click();
  await page.getByRole('tab', { name: /原文/ }).click();
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  await page.getByLabel('页码').fill('20');
  await page.getByLabel('页码').press('Enter');
  await expect(page.getByTestId('pdf-page')).toHaveAttribute('data-page', '20');
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  await expect(page.locator('.pdf-page[data-page="1"] canvas')).toHaveCount(0);
  expect(await page.locator('.pdf-page canvas').count()).toBeLessThan(8);
  await page.getByLabel('页码').fill('1');
  await page.getByLabel('页码').press('Enter');
  await expect(page.getByTestId('pdf-page')).toHaveAttribute('data-page', '1');
  await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
  await page.getByRole('button', { name: '打开追问面板', exact: true }).click();
  await page.screenshot({ path: 'docs/images/panel-0.6.png' });
});
