import { expect, test } from '@playwright/test';
import { makeDocx } from '../fixtures';

test('Read and Work align their chrome and keep import notices compact as the window grows', async ({
  page,
  request,
}) => {
  const base = 'http://127.0.0.1:3100';
  const switchMode = async (mode: 'Read' | 'Work') => {
    await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
    await page.getByRole('menuitemradio', { name: new RegExp('PaperLeaf ' + mode) }).click();
    await expect(page.locator(mode === 'Read' ? '.project-shelf' : '.work-shelf')).toBeVisible();
  };
  const measurements = () =>
    page.evaluate(() => {
      const shelf = document.querySelector(
        '.mode-pane[data-current="true"] .project-shelf,.mode-pane[data-current="true"] .work-shelf',
      )!;
      const box = (selector: string) => {
        const element = shelf.querySelector(selector)!;
        const r = element.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          font: getComputedStyle(element).fontSize,
        };
      };
      const english = shelf.querySelector('.brand-en')!;
      return {
        width: shelf.getBoundingClientRect().width,
        brand: box('.mode-trigger'),
        title: box('.brand-title'),
        english: box('.brand-en'),
        icon: box('.brand-icon'),
        arrow: box('.mode-trigger > svg'),
        upload: box('.shelf-upload'),
        search: box('.shelf-search'),
        footer: box('.settings-button'),
        englishFits: english.scrollWidth <= english.clientWidth + 1,
        englishLine: parseFloat(getComputedStyle(english).lineHeight),
      };
    });
  await page.goto(base);
  for (const width of [980, 1440, 1920]) {
    await page.setViewportSize({ width, height: 960 });
    await switchMode('Read');
    const read = await measurements();
    await expect(page.locator('.brand-title:visible')).toHaveText('知页');
    await switchMode('Work');
    const work = await measurements();
    expect(work.width).toBe(read.width);
    for (const key of ['brand', 'icon', 'arrow', 'upload', 'search', 'footer'] as const) {
      expect(work[key].x, key + ' x').toBeCloseTo(read[key].x, 0);
      expect(work[key].y, key + ' y').toBeCloseTo(read[key].y, 0);
      expect(work[key].height, key + ' height').toBeCloseTo(read[key].height, 0);
    }
    expect(work.title.font).toBe(read.title.font);
    expect(work.title.x).toBeCloseTo(read.title.x, 0);
    expect(work.english).toEqual(read.english);
    expect(work.englishFits).toBe(true);
    expect(work.english.height).toBeCloseTo(work.englishLine, 0);
    await expect(page.locator('.brand-title:visible')).toHaveText('知页work');
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith('/api/work') && r.request().method() === 'POST',
  );
  await page.getByLabel('上传 Work 稿件').setInputFiles({
    name: 'layout-check.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await makeDocx(
      Array.from(
        { length: 80 },
        (_, i) =>
          `Paragraph ${i + 1}: This synthetic manuscript checks scrolling and compact notice layout without any AI calls.`,
      ),
    ),
  });
  const id = (await (await uploaded).json()).id;
  try {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('layout-check');
    const notice = page.locator('.work-notice');
    await expect(notice).toContainText('已导入 1 篇稿件');
    const before = await notice.boundingBox();
    expect(before!.height).toBeLessThan(60);
    const textHeight = (await page.locator('.work-reading-grid').boundingBox())!.height;
    await page.setViewportSize({ width: 1440, height: 1200 });
    expect((await notice.boundingBox())!.height).toBeCloseTo(before!.height, 0);
    expect((await page.locator('.work-reading-grid').boundingBox())!.height).toBeGreaterThan(
      textHeight + 200,
    );
    await expect(page.locator('.work-shelf .shelf-search input')).toHaveCSS(
      'border-top-width',
      '0px',
    );
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: 'test-results/work-layout.png' });
    await page.getByRole('button', { name: '关闭 Work 提示' }).click();
    await expect(notice).toHaveCount(0);
  } finally {
    await request.delete(base + '/api/work/' + id);
    await switchMode('Read');
  }
});
