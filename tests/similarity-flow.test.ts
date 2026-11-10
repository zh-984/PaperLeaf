import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db';
import { makeParagraphs } from '@/lib/work';
import { beginWork, workTaskInput } from '@/server/work/tasks';
import { publicFetch } from '@/server/work/public-fetch';
import { makePdf } from './fixtures';
vi.mock('@/server/work/public-fetch', () => ({ publicFetch: vi.fn() }));
afterAll(async () => {
  await db.$disconnect();
});
it('uses a real PDF parser after HTML failure, retains useful diagnostics, reuses acquired sources and locates matches', async () => {
  const text = 'The study asks how structured reading supports understanding.';
  const pdf = await makePdf(text, 1);
  const mock = vi.mocked(publicFetch);
  mock.mockImplementation(async (url) => {
    if (url.includes('openalex')) throw new Error('来源返回 HTTP 429');
    if (url.includes('fullTextXML')) throw new Error('来源返回 HTTP 403');
    let bytes: Buffer;
    if (url.includes('webservices/rest/search'))
      bytes = Buffer.from(
        '{"resultList":{"result":[{"pmcid":"PMC123","title":"Unavailable paper"}]}}',
      );
    else if (url.includes('export.arxiv'))
      bytes = Buffer.from(
        '<feed><entry><id>https://arxiv.org/abs/2401.12345</id><title>Public paper</title></entry></feed>',
      );
    else if (url.includes('/html/')) throw new Error('来源返回 HTTP 404');
    else bytes = pdf;
    return { bytes, type: url.includes('/pdf/') ? 'application/pdf' : 'text/xml', url };
  });
  const doc = await db.workDocument.create({
    data: {
      title: 'Public source test',
      fileName: 'test.docx',
      filePath: randomUUID() + '.docx',
      fileSize: 0,
      hash: randomUUID(),
      paragraphsJson: JSON.stringify(makeParagraphs([{ page: null, text }])),
    },
  });
  try {
    let job = await beginWork(
      doc.id,
      workTaskInput.parse({ kind: 'similarity', query: 'water splitting' }),
    );
    await job.run();
    let task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } });
    const result = JSON.parse(task.resultsJson);
    expect(task.status).toBe('complete');
    expect(result.comparedSources).toBe(1);
    expect(result.percentage).toBeGreaterThan(50);
    expect(
      result.discovery.failures.some((f: { reason: string }) => f.reason.includes('不存在')),
    ).toBe(true);
    expect(
      result.discovery.providers.find((p: { name: string }) => p.name === 'OpenAlex').status,
    ).toBe('error');
    const fetched = mock.mock.calls.length;
    job = await beginWork(doc.id, workTaskInput.parse({ kind: 'similarity', discover: false }));
    await job.run();
    task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } });
    expect(JSON.parse(task.resultsJson).percentage).toBe(result.percentage);
    expect(mock.mock.calls.length).toBe(fetched);
    expect(await db.workSource.count({ where: { documentId: doc.id } })).toBe(1);
  } finally {
    await db.workDocument.delete({ where: { id: doc.id } });
  }
});
