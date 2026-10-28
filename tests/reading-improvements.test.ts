import { afterAll, expect, it, vi } from 'vitest';
import { repairEncoding, titleFromFirstPage, choosePaperTitle } from '@/lib/paper-title';
import { anchorSchema } from '@/lib/validation';
import { GET, POST, PATCH } from '@/app/api/[...path]/route';
import { db } from '@/server/db';
import { makePdf } from './fixtures';
import { completion } from '@/server/ai/client';
vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => {
    void callback();
  },
}));
const origin = 'http://localhost:3000';
const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
afterAll(async () => {
  await db.$disconnect();
});
it('retries an unsupported AI parameter only once and preserves the selected model', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('unsupported parameter: max_tokens', { status: 400 }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '已解释' } }] }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const result = await completion([{ role: 'user', content: '解释原文' }], undefined, 3000, {
      enabled: true,
      apiKey: 'test-only',
      model: 'reasoning-model',
      baseUrl: 'https://example.com/v1',
    });
    expect(result.text).toBe('已解释');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.model).toBe('reasoning-model');
    expect(body.max_completion_tokens).toBe(3000);
    expect(body.temperature).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('repairs Latin-1 decoded Chinese and preserves legitimate accents', () => {
  const title = '复合催化剂的水热合成及电解水催化性能';
  expect(repairEncoding(Buffer.from(title).toString('latin1'))).toBe(title);
  expect(repairEncoding('Étude du café')).toBe('Étude du café');
});
it('joins a multiline title, excluding journal headers and smaller author lines', () => {
  const item = (str: string, y: number, height: number, x = 40) => ({
    str,
    height,
    width: 200,
    transform: [height, 0, 0, height, x, y],
  });
  const title = titleFromFirstPage(
    [
      item('某某学报', 950, 12),
      item('复合催化剂的水热合成及电解水', 760, 30),
      item('催化性能', 715, 30),
      item('作者姓名', 650, 18),
    ],
    1000,
  );
  expect(title).toBe('复合催化剂的水热合成及电解水催化性能');
  expect(choosePaperTitle('Microsoft Word - draft', 'a.pdf', title)).toBe(title);
});
it('keeps Chinese upload names and persists normalized note anchors and scroll positions', async () => {
  const form = new FormData();
  form.set(
    'file',
    new Blob([new Uint8Array(await makePdf())], { type: 'application/pdf' }),
    '复合催化剂研究.pdf',
  );
  const response = await POST(
    new Request(`${origin}/api/papers`, { method: 'POST', body: form }),
    ctx('papers'),
  );
  expect(response.status).toBe(201);
  const paper = await response.json();
  expect(paper.fileName).toBe('复合催化剂研究.pdf');
  const anchor = {
    version: 1,
    locations: [{ page: 2, rects: [[0.1, 0.25, 0.4, 0.04]], position: 0.25 }],
  };
  const created = await POST(
    new Request(`${origin}/api/papers/${paper.id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content: '对照原文', page: 2, selectedText: 'method', anchor }),
    }),
    ctx('papers', paper.id, 'notes'),
  );
  expect(created.status).toBe(201);
  expect((await created.json()).anchor).toEqual(anchor);
  await PATCH(
    new Request(`${origin}/api/papers/${paper.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ lastPage: 2, lastPosition: 0.45 }),
    }),
    ctx('papers', paper.id),
  );
  const detail = await (
    await GET(new Request(`${origin}/api/papers/${paper.id}`), ctx('papers', paper.id))
  ).json();
  expect(detail.lastPosition).toBe(0.45);
  expect(detail.notes[0].anchor).toEqual(anchor);
  expect(detail.notes[0].anchorJson).toBeUndefined();
  expect(
    anchorSchema.safeParse({ version: 1, locations: [{ page: 1, rects: [[0.9, 0.9, 0.4, 0.4]] }] })
      .success,
  ).toBe(false);
});
it('saves service, model and key, applies immediately and never returns the key', async () => {
  const save = (body: unknown) =>
    POST(
      new Request(`${origin}/api/settings`, { method: 'POST', body: JSON.stringify(body) }),
      ctx('settings'),
    );
  let response = await save({
    baseUrl: 'https://example.com/v1/chat/completions',
    model: 'reading-model',
    apiKey: 'unit-test-private-key',
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain('unit-test-private-key');
  expect(JSON.parse(text)).toMatchObject({
    aiEnabled: true,
    aiBaseUrl: 'https://example.com/v1',
    aiModel: 'reading-model',
    aiHasKey: true,
  });
  response = await save({ baseUrl: 'https://example.com', model: 'updated-model', apiKey: '' });
  expect(await response.json()).toMatchObject({
    aiEnabled: true,
    aiModel: 'updated-model',
    aiHasKey: true,
  });
  expect((await save({ baseUrl: 'file:///tmp', model: 'invalid' })).status).toBe(400);
  expect(
    (await save({ baseUrl: 'https://example.com', model: 'updated-model', clearKey: true })).status,
  ).toBe(200);
  const config = await (await GET(new Request(`${origin}/api/settings`), ctx('settings'))).json();
  expect(config.aiEnabled).toBe(false);
});
