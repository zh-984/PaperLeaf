import { afterAll, expect, it, vi } from 'vitest';
import { access } from 'node:fs/promises';
import { GET, POST, PATCH, DELETE } from '@/app/api/[...path]/route';
import { db } from '@/server/db';
import { safeFilePath } from '@/server/storage';
import { startReport } from '@/server/ai/report';
import { makePdf } from './fixtures';
vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => {
    void callback();
  },
}));
vi.mock('@/server/ai/report', () => ({
  startReport: vi.fn(async () => {}),
  cancelReport: vi.fn(async () => {}),
  recoverInterrupted: vi.fn(async () => {}),
}));
const origin = 'http://localhost:3000',
  ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const request = (path: string, method: string, body?: unknown) =>
  new Request(origin + path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
afterAll(async () => {
  await db.$disconnect();
});
it('creates, renames and persists collapsible project bookshelves, with unique validated names', async () => {
  const created = await POST(
    request('/api/bookshelves', 'POST', { name: '电催化项目' }),
    ctx('bookshelves'),
  );
  expect(created.status).toBe(201);
  const shelf = await created.json();
  expect(
    (await POST(request('/api/bookshelves', 'POST', { name: '电催化项目' }), ctx('bookshelves')))
      .status,
  ).toBe(409);
  expect(
    (await POST(request('/api/bookshelves', 'POST', { name: '  ' }), ctx('bookshelves'))).status,
  ).toBe(400);
  await PATCH(
    request(`/api/bookshelves/${shelf.id}`, 'PATCH', { collapsed: true, name: '催化方向' }),
    ctx('bookshelves', shelf.id),
  );
  expect(await (await GET(request('/api/bookshelves', 'GET'), ctx('bookshelves'))).json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: shelf.id, name: '催化方向', collapsed: true }),
    ]),
  );
});
it('assigns uploads, moves papers, and deletes a shelf while keeping the PDF and notes', async () => {
  const shelf = await (
    await POST(request('/api/bookshelves', 'POST', { name: '资料保留测试' }), ctx('bookshelves'))
  ).json();
  const form = new FormData();
  form.set(
    'file',
    new Blob([new Uint8Array(await makePdf())], { type: 'application/pdf' }),
    'paper.pdf',
  );
  const response = await POST(
    new Request(`${origin}/api/papers?shelfId=${shelf.id}`, { method: 'POST', body: form }),
    ctx('papers'),
  );
  expect(response.status).toBe(201);
  const paper = await response.json();
  expect(paper.shelfId).toBe(shelf.id);
  await POST(
    request(`/api/papers/${paper.id}/notes`, 'POST', { content: '保留的笔记', page: 1 }),
    ctx('papers', paper.id, 'notes'),
  );
  expect(
    (
      await PATCH(
        request(`/api/papers/${paper.id}`, 'PATCH', { shelfId: 'missing-shelf' }),
        ctx('papers', paper.id),
      )
    ).status,
  ).toBe(404);
  await PATCH(
    request(`/api/papers/${paper.id}`, 'PATCH', { shelfId: null }),
    ctx('papers', paper.id),
  );
  await PATCH(
    request(`/api/papers/${paper.id}`, 'PATCH', { shelfId: shelf.id }),
    ctx('papers', paper.id),
  );
  expect(
    (await DELETE(request(`/api/bookshelves/${shelf.id}`, 'DELETE'), ctx('bookshelves', shelf.id)))
      .status,
  ).toBe(200);
  const detail = await (
    await GET(request(`/api/papers/${paper.id}`, 'GET'), ctx('papers', paper.id))
  ).json();
  expect(detail.shelfId).toBeNull();
  expect(detail.notes[0].content).toBe('保留的笔记');
  await expect(
    access(safeFilePath((await db.paper.findUniqueOrThrow({ where: { id: paper.id } })).filePath)),
  ).resolves.toBeUndefined();
});
it('stores app preferences in SQLite and respects disabling automatic AI interpretation', async () => {
  expect(
    await (await GET(request('/api/preferences', 'GET'), ctx('preferences'))).json(),
  ).toMatchObject({
    showAiNotice: true,
    autoInterpret: false,
    defaultView: 'report',
    theme: 'green',
  });
  await PATCH(
    request('/api/preferences', 'PATCH', {
      showAiNotice: false,
      autoInterpret: false,
      reduceMotion: true,
    }),
    ctx('preferences'),
  );
  expect(await db.appPreference.findUnique({ where: { id: 'local' } })).toMatchObject({
    showAiNotice: false,
    autoInterpret: false,
    reduceMotion: true,
  });
  expect(
    (
      await PATCH(
        request('/api/preferences', 'PATCH', { defaultView: 'invalid' }),
        ctx('preferences'),
      )
    ).status,
  ).toBe(400);
  expect(
    (await PATCH(request('/api/preferences', 'PATCH', { theme: 'unknown' }), ctx('preferences')))
      .status,
  ).toBe(400);
  await PATCH(request('/api/preferences', 'PATCH', { theme: 'blue' }), ctx('preferences'));
  expect(await db.appPreference.findUnique({ where: { id: 'local' } })).toMatchObject({
    theme: 'blue',
    autoInterpret: false,
  });
  await POST(
    request('/api/settings', 'POST', {
      baseUrl: 'https://example.com/v1',
      model: 'test-only',
      apiKey: 'test-only-key',
    }),
    ctx('settings'),
  );
  const upload = async () => {
    const form = new FormData();
    form.set(
      'file',
      new Blob([new Uint8Array(await makePdf())], { type: 'application/pdf' }),
      'pref.pdf',
    );
    return POST(new Request(origin + '/api/papers', { method: 'POST', body: form }), ctx('papers'));
  };
  expect((await upload()).status).toBe(201);
  expect(startReport).not.toHaveBeenCalled();
  await PATCH(request('/api/preferences', 'PATCH', { autoInterpret: true }), ctx('preferences'));
  expect((await upload()).status).toBe(201);
  expect(startReport).toHaveBeenCalledTimes(1);
});
