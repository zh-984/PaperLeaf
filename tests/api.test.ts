import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { access } from 'node:fs/promises';
import { GET, POST, PATCH, DELETE } from '@/app/api/[...path]/route';
import { POST as ask } from '@/app/api/ai/ask/[id]/route';
import { db } from '@/server/db';
import { getPages } from '@/server/papers';
import { safeFilePath } from '@/server/storage';
import { makePdf } from './fixtures';

vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => {
    void callback();
  },
}));
const origin = 'http://localhost:3000';
function ctx(...path: string[]) {
  return { params: Promise.resolve({ path }) };
}
let paperId = '';
let storedPath = '';
beforeAll(async () => {
  await db.paper.deleteMany();
});
afterAll(async () => {
  await db.$disconnect();
});
describe('real SQLite and file API', () => {
  it('streams a PDF upload and persists the record without exposing its path', async () => {
    const form = new FormData();
    form.set(
      'file',
      new Blob([new Uint8Array(await makePdf())], { type: 'application/pdf' }),
      '../../original.pdf',
    );
    const response = await POST(
      new Request(`${origin}/api/papers`, { method: 'POST', body: form }),
      ctx('papers'),
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const paper = await response.json();
    paperId = paper.id;
    expect(paper.title).toBe('A Clearer Way to Read');
    expect(paper.pageCount).toBe(3);
    expect(paper.filePath).toBeUndefined();
    expect(paper.report.status).toBe('idle');
    const record = await db.paper.findUniqueOrThrow({ where: { id: paperId } });
    storedPath = safeFilePath(record.filePath);
    await expect(access(storedPath)).resolves.toBeUndefined();
  });
  it('extracts and caches text entirely locally', async () => {
    const pages = await getPages(paperId);
    expect(pages).toHaveLength(3);
    expect(pages[1].text).toContain('controlled experiment');
    expect((await db.paper.findUniqueOrThrow({ where: { id: paperId } })).textJson).toContain(
      'controlled experiment',
    );
  });
  it('returns ranges and rejects invalid ranges', async () => {
    const response = await GET(
      new Request(`${origin}/api/papers/${paperId}/file`, { headers: { Range: 'bytes=0-4' } }),
      ctx('papers', paperId, 'file'),
    );
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('%PDF-');
    const invalid = await GET(
      new Request(`${origin}/api/papers/${paperId}/file`, {
        headers: { Range: 'bytes=999999999-' },
      }),
      ctx('papers', paperId, 'file'),
    );
    expect(invalid.status).toBe(416);
  });
  it('stores reading position, validates bounds and renames papers', async () => {
    const response = await PATCH(
      new Request(`${origin}/api/papers/${paperId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: '我的论文', lastPage: 2 }),
      }),
      ctx('papers', paperId),
    );
    expect(response.status).toBe(200);
    const fresh = await GET(new Request(`${origin}/api/papers/${paperId}`), ctx('papers', paperId));
    const data = await fresh.json();
    expect(data.lastPage).toBe(2);
    expect(data.title).toBe('我的论文');
    expect(
      (
        await PATCH(
          new Request(`${origin}/api/papers/${paperId}`, {
            method: 'PATCH',
            body: JSON.stringify({ lastPage: 9 }),
          }),
          ctx('papers', paperId),
        )
      ).status,
    ).toBe(400);
  });
  it('persists notes and refuses stale edits instead of losing newer content', async () => {
    const note = await (
      await POST(
        new Request(`${origin}/api/papers/${paperId}/notes`, {
          method: 'POST',
          body: JSON.stringify({ content: 'first', page: 2 }),
        }),
        ctx('papers', paperId, 'notes'),
      )
    ).json();
    const update = (version: number, content: string) =>
      PATCH(
        new Request(`${origin}/api/papers/${paperId}/notes/${note.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ content, version, page: 2 }),
        }),
        ctx('papers', paperId, 'notes', note.id),
      );
    expect((await update(0, '保存后的笔记')).status).toBe(200);
    expect((await update(0, '旧窗口')).status).toBe(409);
    expect((await db.note.findUniqueOrThrow({ where: { id: note.id } })).content).toBe(
      '保存后的笔记',
    );
  });
  it('rejects cross-origin writes and malformed uploads', async () => {
    const localAlias = await PATCH(
      new Request(`http://localhost:3000/api/papers/${paperId}`, {
        method: 'PATCH',
        headers: {
          Host: '127.0.0.1:3000',
          Origin: 'http://127.0.0.1:3000',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: JSON.stringify({ title: '我的论文' }),
      }),
      ctx('papers', paperId),
    );
    expect(localAlias.status).toBe(200);
    expect(
      (
        await PATCH(
          new Request(`${origin}/api/papers/${paperId}`, {
            method: 'PATCH',
            headers: { Origin: 'https://evil.example' },
            body: '{}',
          }),
          ctx('papers', paperId),
        )
      ).status,
    ).toBe(403);
    const form = new FormData();
    form.set('file', new Blob(['<script>bad</script>'], { type: 'application/pdf' }), 'fake.pdf');
    expect(
      (
        await POST(
          new Request(`${origin}/api/papers`, { method: 'POST', body: form }),
          ctx('papers'),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          new Request(`${origin}/api/papers`, {
            method: 'POST',
            headers: { 'content-type': 'multipart/form-data; boundary=bad' },
            body: 'bad',
          }),
          ctx('papers'),
        )
      ).status,
    ).toBe(400);
  });
  it('degrades AI requests without a key', async () => {
    const response = await ask(
      new Request(`${origin}/api/ai/ask/${paperId}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'question', question: 'why', page: 1 }),
      }),
      { params: Promise.resolve({ id: paperId }) },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('未配置 AI');
  });
  it('deletes the local PDF and all dependent data', async () => {
    await db.aiHistory.create({ data: { paperId, page: 1, action: 'question', answer: 'test' } });
    const response = await DELETE(
      new Request(`${origin}/api/papers/${paperId}`, { method: 'DELETE' }),
      ctx('papers', paperId),
    );
    expect(response.status).toBe(200);
    await expect(access(storedPath)).rejects.toThrow();
    expect(await db.note.count({ where: { paperId } })).toBe(0);
    expect(await db.aiHistory.count({ where: { paperId } })).toBe(0);
    expect(await db.insightReport.count({ where: { paperId } })).toBe(0);
  });
});
