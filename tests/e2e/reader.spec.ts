import { openNotes } from '../ui-helpers';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { access, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { makePdf } from '../fixtures';
import { reportDefinitions, type PaperDetail } from '../../src/lib/types';

const local = 'http://127.0.0.1:3100';
const ai = 'http://127.0.0.1:3101';
const mock = 'http://127.0.0.1:4123';
async function clear(request: APIRequestContext, base: string) {
  const list = await (await request.get(`${base}/api/papers`)).json();
  for (const paper of list) await request.delete(`${base}/api/papers/${paper.id}`);
}
async function upload(page: Page, title: string, pages = 3) {
  await expect(page.locator('.workspace-loading')).toHaveCount(0);
  await page.getByLabel('上传 PDF 文件').setInputFiles({
    name: `${title}.pdf`,
    mimeType: 'application/pdf',
    buffer: await makePdf(title, pages),
  });
  await expect(page.locator('main h1')).toHaveText(title);
  return new URL(page.url()).searchParams.get('paper')!;
}
async function completeReport(request: APIRequestContext, id: string) {
  await expect
    .poll(
      async () => {
        const data = await (await request.get(`${ai}/api/papers/${id}`)).json();
        return data.report.status;
      },
      { timeout: 60000 },
    )
    .toBe('complete');
}
test.describe('local reading without AI', () => {
  test('upload, PDF rendering, selection fallback, page memory, notes, rename, mobile and deletion', async ({
    page,
    request,
  }) => {
    await clear(request, local);
    await page.goto(local);
    await expect(page.getByText('放入你的第一篇文献')).toBeVisible();
    await mkdir('test-results/screenshots', { recursive: true });
    await page.screenshot({ path: 'test-results/screenshots/empty-desktop.png' });
    const id = await upload(page, 'Reading Without Cloud');
    await expect(page.getByRole('tab', { name: '解读报告' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.reload();
    await expect(page.locator('main h1')).toHaveText('Reading Without Cloud');
    await page.getByRole('button', { name: '未配置 AI', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'AI 配置' })).toBeVisible();
    await page.getByRole('button', { name: '关闭设置' }).click();
    await page.getByRole('tab', { name: /原文/ }).click();
    await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
    await expect(page.getByTestId('pdf-text-layer').locator('span').first()).toContainText(
      'Introduction',
    );
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.getByTestId('pdf-page')).toHaveAttribute('data-page', '2');
    await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
    const before = await page.getByLabel('缩放比例').textContent();
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await expect(page.getByLabel('缩放比例')).not.toHaveText(before!);
    await page.getByRole('button', { name: '适应宽度' }).click();
    const selected = page
      .getByTestId('pdf-text-layer')
      .locator('span')
      .filter({ hasText: 'The method uses a controlled experiment.' })
      .first();
    await selected.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await selected.dispatchEvent('mouseup');
    await expect(page.getByRole('toolbar', { name: '划词操作' })).toBeVisible();
    await page.getByRole('button', { name: '翻译', exact: true }).click();
    await expect(page.locator('.toast[role="alert"]')).toContainText('未配置 AI');
    await page.getByRole('button', { name: '收起追问面板' }).click();
    await page.getByLabel('页码', { exact: true }).fill('3');
    await page.getByLabel('页码', { exact: true }).press('Enter');
    await expect
      .poll(async () => (await (await request.get(`${local}/api/papers/${id}`)).json()).lastPage)
      .toBe(3);
    await page.reload();
    await page.getByRole('tab', { name: /原文/ }).click();
    await expect(page.getByTestId('pdf-page')).toHaveAttribute('data-page', '3');
    await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
    await openNotes(page);
    await page.getByRole('button', { name: '新建笔记' }).click();
    await page.getByLabel('笔记内容').fill('我的理解：样本规模限制了研究的推广。');
    await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await request.get(`${local}/api/papers/${id}`)).json()).notes[0]?.content,
      )
      .toContain('样本规模');
    await page.reload();
    await openNotes(page);
    await expect(page.getByLabel('笔记内容')).toHaveValue('我的理解：样本规模限制了研究的推广。');
    await page.getByRole('button', { name: '收起追问面板' }).click();
    await page.locator('summary[aria-label="Reading Without Cloud 更多操作"]').click();
    await page.getByRole('button', { name: '重命名', exact: true }).click();
    await page.getByLabel('文献标题').fill('我的本地文献');
    await page.getByRole('button', { name: '保存标题' }).click();
    await expect(page.locator('main h1')).toHaveText('我的本地文献');
    await page.screenshot({ path: 'test-results/screenshots/report-no-ai.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '打开书架' })).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await page.locator('.shelf').boundingBox();
        return bounds!.x + bounds!.width;
      })
      .toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: 'test-results/screenshots/mobile.png' });
    await page.setViewportSize({ width: 1440, height: 960 });
    const sqlite = new DatabaseSync(path.resolve('.test-data/e2e-local/library.db'));
    const record = sqlite.prepare('SELECT filePath FROM Paper WHERE id = ?').get(id) as {
      filePath: string;
    };
    sqlite.close();
    await page.locator('summary[aria-label="我的本地文献 更多操作"]').click();
    await page.getByRole('button', { name: '删除文献', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除文献', exact: true }).click();
    await expect(page.getByText('放入你的第一篇文献')).toBeVisible();
    expect((await request.get(`${local}/api/papers/${id}`)).status()).toBe(404);
    await expect(
      access(path.resolve('.test-data/e2e-local/uploads', record.filePath)),
    ).rejects.toThrow();
  });
  test('multiple uploads, drag and drop, unsaved draft recovery and conflict protection', async ({
    page,
    request,
  }) => {
    await clear(request, local);
    await page.goto(local);
    await expect(page.getByText('放入你的第一篇文献')).toBeVisible();
    await page.getByLabel('上传 PDF 文件').setInputFiles([
      { name: 'one.pdf', mimeType: 'application/pdf', buffer: await makePdf('First Paper') },
      { name: 'two.pdf', mimeType: 'application/pdf', buffer: await makePdf('Second Paper') },
    ]);
    await expect(page.locator('.shelf-item')).toHaveCount(2);
    await expect(page.locator('main h1')).toHaveText('First Paper');
    const transfer = await page.evaluateHandle(
      (bytes) => {
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array(bytes)], 'drag.pdf', { type: 'application/pdf' }));
        return data;
      },
      Array.from(await makePdf('Dragged Paper')),
    );
    await page.locator('.workspace').dispatchEvent('drop', { dataTransfer: transfer });
    await expect(page.locator('.shelf-item')).toHaveCount(3);
    await expect(page.locator('main h1')).toHaveText('Dragged Paper');
    const id = new URL(page.url()).searchParams.get('paper')!;
    await openNotes(page);
    await page.getByRole('button', { name: '新建笔记' }).click();
    await expect(page.getByLabel('笔记内容')).toBeVisible();
    const paper: PaperDetail = await (await request.get(`${local}/api/papers/${id}`)).json();
    const note = paper.notes[0];
    await page.evaluate(
      ({ id, version }) => {
        localStorage.setItem(
          `paperleaf:note:${id}`,
          JSON.stringify({ content: '恢复的本地草稿', baseVersion: version }),
        );
      },
      { id: note.id, version: note.version },
    );
    await page.reload();
    await openNotes(page);
    await expect(page.getByLabel('笔记内容')).toHaveValue('恢复的本地草稿');
    await expect
      .poll(
        async () =>
          (await (await request.get(`${local}/api/papers/${id}`)).json()).notes[0].content,
      )
      .toBe('恢复的本地草稿');
    const saved: PaperDetail = await (await request.get(`${local}/api/papers/${id}`)).json();
    const version = saved.notes[0].version;
    await page.evaluate(
      ({ id, version }) => {
        localStorage.setItem(
          `paperleaf:note:${id}`,
          JSON.stringify({ content: '旧窗口的草稿', baseVersion: version }),
        );
      },
      { id: note.id, version },
    );
    expect(
      (
        await request.patch(`${local}/api/papers/${id}/notes/${note.id}`, {
          data: { content: '另一个窗口的新内容', version },
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await openNotes(page);
    await expect(page.getByLabel('笔记内容')).toHaveValue('旧窗口的草稿');
    await expect(page.getByText('草稿与已保存版本不同', { exact: false })).toBeVisible();
    expect((await (await request.get(`${local}/api/papers/${id}`)).json()).notes[0].content).toBe(
      '另一个窗口的新内容',
    );
    await page.getByRole('button', { name: '采用服务器已保存内容' }).click();
    await expect(page.getByLabel('笔记内容')).toHaveValue('另一个窗口的新内容');
  });
});
test.describe('AI report pipeline using a local simulator', () => {
  test.beforeEach(async ({ request }) => {
    await request.patch(ai + '/api/preferences', { data: { autoInterpret: true } });
  });
  test('auto report, incremental sections, evidence highlight, follow-ups, saved AI notes, cache and regeneration', async ({
    page,
    request,
  }) => {
    await clear(request, ai);
    await request.post(`${mock}/control`, { data: { delay: 500 } });
    await page.goto(ai);
    const id = await upload(page, 'Structured Reading Study');
    await expect(page.locator('.section-conclusion').first()).toBeVisible();
    expect(await page.locator('.section-conclusion').count()).toBeLessThan(10);
    await Promise.all([
      request.post(`${ai}/api/ai/report/${id}`, { data: { force: false } }),
      request.post(`${ai}/api/ai/report/${id}`, { data: { force: false } }),
    ]);
    await completeReport(request, id);
    await expect(page.locator('.section-conclusion')).toHaveCount(10);
    for (const [key] of reportDefinitions)
      await expect(page.getByTestId(`section-${key}`).locator('.section-conclusion')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/report-ai.png' });
    const calls = (await (await request.get(`${mock}/stats`)).json()).calls.length;
    const initialCalls = (await (await request.get(`${mock}/stats`)).json()).calls;
    for (const [key] of reportDefinitions)
      expect(initialCalls.filter((call: { task: string }) => call.task === key)).toHaveLength(1);
    await page.reload();
    await expect(page.locator('.section-conclusion')).toHaveCount(10);
    expect((await (await request.get(`${mock}/stats`)).json()).calls.length).toBe(calls);
    await page
      .getByTestId('section-summary')
      .getByRole('button', { name: /查看原文依据/ })
      .first()
      .click();
    await expect(page.getByTestId('pdf-page')).toHaveAttribute('data-page', '2');
    await expect(page.locator('.evidence-highlight').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/reader-highlight.png' });
    const selected = page.locator('.evidence-highlight').first();
    const box = await selected.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 1, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByRole('toolbar', { name: '划词操作' })).toBeVisible();
    await page.getByRole('button', { name: '通俗解释', exact: true }).click();
    await expect(page.locator('.chat-answer')).toHaveCount(1);
    await page.getByLabel('追问问题').fill('这个方法为什么需要对照组？');
    await page.getByRole('button', { name: '发送追问' }).click();
    await expect(page.locator('.chat-answer')).toHaveCount(2);
    for (const [index, label] of ['翻译', '术语解释'].entries()) {
      await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
      const span = page
        .getByTestId('pdf-text-layer')
        .locator('span')
        .filter({ hasText: 'The method uses a controlled experiment.' })
        .first();
      await span.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selected = window.getSelection()!;
        selected.removeAllRanges();
        selected.addRange(range);
      });
      await span.dispatchEvent('mouseup');
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('.chat-answer')).toHaveCount(index + 3);
    }
    await page.getByRole('button', { name: '片段 + 解释' }).first().click();
    await page.getByRole('button', { name: /^笔记/ }).last().click();
    await expect(page.getByLabel('笔记内容')).toHaveValue(/对照实验/);
    await page.reload();
    await openNotes(page);
    await expect(page.getByLabel('笔记内容')).toHaveValue(/对照实验/);
    await page.getByRole('button', { name: '收起追问面板' }).click();
    await page.getByRole('button', { name: '重新解读', exact: true }).click();
    await completeReport(request, id);
    await expect(page.locator('.section-conclusion')).toHaveCount(10);
    const fresh: PaperDetail = await (await request.get(`${ai}/api/papers/${id}`)).json();
    expect(fresh.report?.version).toBe(2);
  });
  test('long documents resume after a failed segment without repeating successful requests', async ({
    request,
  }) => {
    await request.post(`${mock}/control`, { data: { failSummaryAt: 2, delay: 20 } });
    const response = await request.post(`${ai}/api/papers`, {
      multipart: {
        file: {
          name: 'long.pdf',
          mimeType: 'application/pdf',
          buffer: await makePdf('Long Study', 80),
        },
      },
    });
    expect(response.status()).toBe(201);
    const paper = await response.json();
    await expect
      .poll(
        async () =>
          (await (await request.get(`${ai}/api/papers/${paper.id}`)).json()).report.status,
      )
      .toBe('failed');
    const before = (await (await request.get(`${mock}/stats`)).json()).calls;
    expect(before.filter((call: { task: string }) => call.task === 'chunk-summary')).toHaveLength(
      2,
    );
    const successfulHash = before.find((call: { failed: boolean }) => !call.failed).hash;
    expect(
      (await request.post(`${ai}/api/ai/report/${paper.id}`, { data: { force: false } })).status(),
    ).toBe(202);
    await completeReport(request, paper.id);
    const after = (await (await request.get(`${mock}/stats`)).json()).calls;
    expect(after.filter((call: { hash: string }) => call.hash === successfulHash)).toHaveLength(1);
    expect(after.every((call: { inputLength: number }) => call.inputLength < 16000)).toBe(true);
    const final: PaperDetail = await (await request.get(`${ai}/api/papers/${paper.id}`)).json();
    expect(final.report?.sections).toHaveLength(10);
    expect(final.report?.status).toBe('complete');
  });
});
