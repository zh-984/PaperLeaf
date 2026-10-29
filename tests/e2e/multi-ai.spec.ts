import { test, expect } from '@playwright/test';
import { makePdf } from '../fixtures';
const base = 'http://127.0.0.1:3101',
  mock = 'http://127.0.0.1:4123';
test('three private configurations, selected model and explicitly linked literature', async ({
  page,
  request,
}) => {
  await request.patch(base + '/api/preferences', {
    data: { autoInterpret: false, defaultView: 'report' },
  });
  await request.post(mock + '/control', { data: { delay: 20 } });
  const original = await (await request.get(base + '/api/settings')).json();
  for (const [slot, model] of [
    [2, 'test-alt'],
    [3, 'test-third'],
  ] as const) {
    const result = await request.post(base + '/api/settings', {
      data: { slot, baseUrl: mock + '/v1', model, apiKey: `private-slot-${slot}` },
    });
    expect(result.ok()).toBe(true);
    expect(JSON.stringify(await result.json())).not.toContain(`private-slot-${slot}`);
  }
  const updated = await (
    await request.post(base + '/api/settings', {
      data: { slot: 2, baseUrl: mock + '/v1', model: 'test-alt-renamed' },
    })
  ).json();
  expect(updated.aiProfiles.find((p: { slot: number }) => p.slot === 2)).toMatchObject({
    model: 'test-alt-renamed',
    enabled: true,
    hasKey: true,
  });
  expect(updated.aiProfiles.find((p: { slot: number }) => p.slot === 1)).toMatchObject({
    model: original.aiModel,
    enabled: original.aiEnabled,
  });
  expect(
    (
      await request.post(base + '/api/settings', {
        data: { slot: 4, baseUrl: mock + '/v1', model: 'bad', apiKey: 'x' },
      })
    ).status(),
  ).toBe(400);
  const shelf = await (
    await request.post(base + '/api/bookshelves', { data: { name: 'Other project' } })
  ).json();
  const upload = async (title: string, shelfId?: string) => {
    const r = await request.post(base + '/api/papers' + (shelfId ? `?shelfId=${shelfId}` : ''), {
      multipart: {
        file: {
          name: `${title}.pdf`,
          mimeType: 'application/pdf',
          buffer: await makePdf(title, 3),
        },
      },
    });
    expect(r.ok()).toBe(true);
    return r.json();
  };
  const linked = await upload('Linked Reference', shelf.id),
    current = await upload('Current Paper');
  try {
    await page.goto(`${base}/?paper=${current.id}`);
    await expect(page.locator('main h1')).toHaveText('Current Paper');
    await page.getByRole('button', { name: '设置与隐私', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'AI 配置', exact: true }).click();
    await dialog.getByLabel('配置位置').selectOption('3');
    await expect(dialog.getByLabel('模型名称')).toHaveValue('test-third');
    await expect(dialog.getByLabel(/API Key/)).toHaveValue('');
    await dialog.getByLabel('模型名称').fill('test-third-edited');
    await dialog.getByRole('button', { name: '保存 AI 配置' }).click();
    await expect(dialog.getByRole('status')).toContainText('已保存');
    await dialog.getByRole('button', { name: '关闭设置' }).click();
    await page.getByRole('button', { name: '打开追问面板', exact: true }).click();
    await page.getByLabel('选择回答模型').selectOption('2');
    await page.getByText('书架联动', { exact: true }).click();
    await expect(page.getByLabel('搜索关联文献标题')).toHaveCount(0);
    await expect(page.locator('.link-picker')).toHaveCount(0);
    await expect(page.getByText('追问发送至：127.0.0.1:4123')).toBeVisible();
    await expect(page.getByLabel('选择回答模型')).toHaveCSS('font-size', '11px');
    await page.getByLabel('追问问题').fill('比较当前文献和 Linked Reference');
    if (process.env.PAPERLEAF_CAPTURE) await page.screenshot({ path: 'test-results/compose.png' });
    await page.getByRole('button', { name: '发送追问' }).click();
    await expect(page.locator('.chat-answer')).toHaveCount(1);
    await expect(page.locator('.chat-answer > p')).toHaveCSS('line-height', '19.6px');
    let calls = (await (await request.get(mock + '/stats')).json()).calls.filter(
      (c: { task: string }) => c.task === 'ask',
    );
    expect(calls.at(-1)).toMatchObject({ model: 'test-alt-renamed', hasLinkedSource: true });
    await page.getByRole('tab', { name: /原文/ }).click();
    await expect(page.getByTestId('pdf-page')).toHaveClass(/ready/);
    const span = page
      .getByTestId('pdf-text-layer')
      .locator('span')
      .filter({ hasText: 'The method uses a controlled experiment.' })
      .first();
    await span.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await span.dispatchEvent('mouseup');
    await page.getByRole('toolbar').getByRole('button', { name: '通俗解释' }).click();
    await expect(page.locator('.chat-answer')).toHaveCount(2);
    calls = (await (await request.get(mock + '/stats')).json()).calls.filter(
      (c: { task: string }) => c.task === 'ask',
    );
    expect(calls.at(-1)).toMatchObject({ model: 'test-alt-renamed', hasLinkedSource: true });
    await page.getByText('书架联动', { exact: true }).click();
    await page.getByLabel('追问问题').fill('只问当前文献和 Linked Reference');
    await page.getByRole('button', { name: '发送追问' }).click();
    await expect(page.locator('.chat-answer')).toHaveCount(3);
    calls = (await (await request.get(mock + '/stats')).json()).calls.filter(
      (c: { task: string }) => c.task === 'ask',
    );
    expect(calls.at(-1)).toMatchObject({ model: 'test-alt-renamed', hasLinkedSource: false });
    const bad = await request.post(`${base}/api/ai/ask/${current.id}`, {
      data: {
        page: 1,
        action: 'question',
        question: 'test',
        aiSlot: 2,
        linkedPaperIds: Array.from({ length: 9 }, (_, i) => `paper${i}`),
      },
    });
    expect(bad.status()).toBe(400);
  } finally {
    for (const item of [linked, current]) await request.delete(`${base}/api/papers/${item.id}`);
    await request.delete(`${base}/api/bookshelves/${shelf.id}`);
    for (const slot of [2, 3])
      await request.post(base + '/api/settings', {
        data: { slot, baseUrl: mock + '/v1', model: 'test-unused', clearKey: true },
      });
  }
});
