import { test, expect } from '@playwright/test';
import { makePdf } from '../fixtures';

const base = 'http://127.0.0.1:3100',
  mock = 'http://127.0.0.1:4123';
test('manual AI, opaque reading text, white content, persistent chrome themes and outside-dismiss menus', async ({
  page,
  request,
}) => {
  for (const paper of await (await request.get(`${base}/api/papers`)).json())
    await request.delete(`${base}/api/papers/${paper.id}`);
  await request.post(`${base}/api/settings`, {
    data: { baseUrl: mock + '/v1', apiKey: 'local-test-key', model: 'test-simulator' },
  });
  await request.patch(`${base}/api/preferences`, {
    data: { autoInterpret: false, defaultView: 'report', theme: 'green', showAiNotice: true },
  });
  await request.post(mock + '/control', { data: { delay: 10 } });
  try {
    await page.goto(base);
    await expect(page.getByText('放入你的第一篇文献')).toBeVisible();
    await page.getByLabel('上传 PDF 文件').setInputFiles({
      name: 'Manual Reading.pdf',
      mimeType: 'application/pdf',
      buffer: await makePdf('Manual Reading'),
    });
    await expect(page.locator('main h1')).toHaveText('Manual Reading');
    const id = new URL(page.url()).searchParams.get('paper')!;
    await page.reload();
    await expect(page.getByRole('button', { name: '开始解读', exact: true })).toBeVisible();
    expect(
      (await (await request.get(`${base}/api/papers/${id}`)).json()).report?.status || 'idle',
    ).toBe('idle');
    expect((await (await request.get(mock + '/stats')).json()).calls).toHaveLength(0);
    await page.getByRole('button', { name: '开始解读', exact: true }).click();
    await expect(page.locator('.report-status')).toContainText('已完成', {
      timeout: 60000,
    });
    await expect(page.locator('.insight-section.has-content')).toHaveCount(10);
    const reading = await page
      .locator('.section-conclusion')
      .first()
      .evaluate((el) => ({
        color: getComputedStyle(el).color,
        opacity: getComputedStyle(el).opacity,
        background: getComputedStyle(el).backgroundColor,
      }));
    expect(reading).toEqual({
      color: 'rgb(0, 0, 0)',
      opacity: '1',
      background: 'rgb(255, 255, 255)',
    });
    await expect(page.locator('.insight-points p').first()).toHaveCSS('color', 'rgb(0, 0, 0)');
    const paperMenu = page.locator('.paper-menu').first();
    await paperMenu.locator('summary').click();
    await expect(paperMenu).toHaveAttribute('open', '');
    await page.locator('main h1').click();
    await expect(paperMenu).not.toHaveAttribute('open', '');
    await paperMenu.locator('summary').click();
    await page.keyboard.press('Escape');
    await expect(paperMenu).not.toHaveAttribute('open', '');
    await page.getByRole('button', { name: '新建书架', exact: true }).click();
    await page.getByLabel('书架名称').fill('主题测试');
    await page.getByRole('button', { name: '保存书架' }).click();
    const shelfMenu = page.locator('.bookshelf-menu').last();
    await shelfMenu.locator('summary').click();
    await expect(shelfMenu).toHaveAttribute('open', '');
    await page.locator('main h1').click();
    await expect(shelfMenu).not.toHaveAttribute('open', '');
    await page.getByRole('button', { name: '设置与隐私', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '阅读与外观', exact: true }).click();
    for (const [value, label, color] of [
      ['blue', '浅蓝色', 'rgb(234, 242, 251)'],
      ['yellow', '浅黄色', 'rgb(250, 243, 220)'],
      ['white', '纯白色', 'rgb(255, 255, 255)'],
      ['green', '浅绿色', 'rgb(237, 241, 233)'],
    ] as const) {
      await dialog.getByRole('radio', { name: label, exact: true }).check();
      await expect(page.locator('html')).toHaveAttribute('data-theme', value);
      await expect(page.locator('.shelf')).toHaveCSS('background-color', color);
      await expect(page.locator('.report-scroll')).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)',
      );
    }
    await dialog.getByRole('radio', { name: '浅蓝色', exact: true }).check();
    await expect
      .poll(async () => (await (await request.get(`${base}/api/preferences`)).json()).theme)
      .toBe('blue');
    await dialog.getByRole('button', { name: '关闭设置' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'blue');
    await page.locator('.report-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    const bounds = await page.evaluate(() => ({
      height: innerHeight,
      scroll: document.documentElement.scrollHeight,
      shelfBottom: document.querySelector('.shelf')!.getBoundingClientRect().bottom,
    }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.height + 1);
    expect(bounds.shelfBottom).toBeCloseTo(bounds.height, 0);
    await page.screenshot({ path: 'docs/images/reading-0.5.png' });
  } finally {
    await request.post(`${base}/api/settings`, {
      data: { baseUrl: mock + '/v1', model: 'test-simulator', clearKey: true },
    });
    await request.patch(`${base}/api/preferences`, {
      data: { autoInterpret: false, theme: 'green', defaultView: 'report' },
    });
  }
});
