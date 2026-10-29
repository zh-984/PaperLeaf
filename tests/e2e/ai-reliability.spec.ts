import { test, expect } from '@playwright/test';
import path from 'node:path';
const base = 'http://127.0.0.1:3101',
  mock = 'http://127.0.0.1:4123';
test('short and long section outputs finish the demo report, while general chat scrolls to the latest message', async ({
  page,
  request,
}) => {
  await request.patch(`${base}/api/preferences`, {
    data: { autoInterpret: false, defaultView: 'report', theme: 'blue' },
  });
  await request.post(`${mock}/control`, {
    data: { delay: 100, pointCounts: { findings: 1, terms: 0, questions: 7 } },
  });
  try {
    await page.goto(base);
    await expect(page.locator('.workspace-loading')).toHaveCount(0);
    await page.getByLabel('上传 PDF 文件').setInputFiles(path.resolve('examples/sample-paper.pdf'));
    await expect(page.locator('main h1')).toHaveText('Paperleaf Synthetic Demo');
    await page.getByRole('button', { name: '开始解读', exact: true }).click();
    await expect(page.locator('.report-status')).toHaveText('已完成', { timeout: 60000 });
    const id = new URL(page.url()).searchParams.get('paper')!;
    const data = await (await request.get(`${base}/api/papers/${id}`)).json();
    expect(data.report.sections).toHaveLength(10);
    expect(
      data.report.sections.find((s: { key: string }) => s.key === 'findings').points,
    ).toHaveLength(1);
    expect(
      data.report.sections.find((s: { key: string }) => s.key === 'terms').points[0],
    ).toMatchObject({ page: null, verified: false, text: expect.stringContaining('不确定') });
    expect(
      data.report.sections.find((s: { key: string }) => s.key === 'questions').points,
    ).toHaveLength(5);
    await page.getByRole('button', { name: '打开追问面板', exact: true }).click();
    for (let i = 0; i < 5; i++) {
      await page.getByLabel('追问问题').fill(i === 4 ? '特朗普是谁' : `解释当前研究 ${i}`);
      await page.getByRole('button', { name: '发送追问' }).click();
      await expect(page.locator('.chat-answer')).toHaveCount(i + 1);
    }
    await expect(page.locator('.chat-question').last()).toContainText('特朗普是谁');
    await expect(page.locator('.chat-answer').last()).toContainText('原文未提到特朗普');
    const bounds = await page.locator('.chat-history').evaluate((el) => ({
      gap: el.scrollHeight - el.scrollTop - el.clientHeight,
      background: getComputedStyle(
        el.querySelector('.chat-question:last-of-type > p') ||
          el.querySelector('.chat-question > p')!,
      ).backgroundColor,
    }));
    expect(bounds.gap).toBeLessThan(3);
    await expect(page.locator('.chat-question > p').first()).toHaveCSS(
      'background-color',
      'rgb(208, 226, 247)',
    );
    const geometry = await page
      .locator('.chat-question')
      .first()
      .evaluate((el) => ({
        right: el.getBoundingClientRect().right,
        parent: el.parentElement!.getBoundingClientRect().right,
      }));
    expect(Math.abs(geometry.right - geometry.parent)).toBeLessThan(2);
    const calls = (await (await request.get(`${mock}/stats`)).json()).calls;
    expect(
      calls
        .filter((call: { task: string }) => call.task === 'ask')
        .every((call: { generalKnowledgeAllowed: boolean }) => call.generalKnowledgeAllowed),
    ).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: '打开追问面板', exact: true }).click();
    await expect(page.locator('.chat-question').last()).toContainText('特朗普是谁');
  } finally {
    await request.patch(`${base}/api/preferences`, {
      data: { autoInterpret: false, theme: 'green' },
    });
  }
});
