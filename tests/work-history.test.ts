import { afterAll, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { workHandler } from '@/app/api/work/[[...path]]/route';
import { randomUUID } from 'node:crypto';
vi.mock('next/server', () => ({ after: () => {} }));
afterAll(async () => {
  await db.$disconnect();
});
it('deletes a history record together with its report, retains original and cache, and refuses a running record', async () => {
  const doc = await db.workDocument.create({
    data: {
      title: 'History test',
      fileName: 'test.docx',
      filePath: randomUUID() + '.docx',
      fileSize: 0,
      hash: randomUUID(),
      paragraphsJson: '[]',
    },
  });
  try {
    const task = await db.workTask.create({
      data: {
        documentId: doc.id,
        kind: 'aigc',
        status: 'complete',
        paramsJson: '{}',
        resultsJson: '{"findings":[{"reason":"saved report"}]}',
      },
    });
    await db.workCache.create({ data: { documentId: doc.id, key: 'saved', content: 'reusable' } });
    const call = (id: string) =>
      workHandler(
        new Request(`http://localhost/api/work/${doc.id}/tasks/${id}?remove=true`, {
          method: 'DELETE',
        }),
        { params: Promise.resolve({ path: [doc.id, 'tasks', id] }) },
      );
    expect((await call(task.id)).status).toBe(200);
    expect(await db.workTask.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await db.workCache.count({ where: { documentId: doc.id } })).toBe(1);
    expect(await db.workDocument.findUnique({ where: { id: doc.id } })).not.toBeNull();
    const running = await db.workTask.create({
      data: { documentId: doc.id, kind: 'similarity', paramsJson: '{}' },
    });
    expect((await call(running.id)).status).toBe(409);
  } finally {
    await db.workDocument.delete({ where: { id: doc.id } });
  }
});
