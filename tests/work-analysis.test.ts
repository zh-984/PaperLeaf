import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db';
import { completion } from '@/server/ai/client';
import { parseWorkAnalysis, parseWorkPartial } from '@/server/work/analysis';
import { beginWork, workTaskInput } from '@/server/work/tasks';
import { makeParagraphs, type WorkParagraph } from '@/lib/work';
vi.mock('@/server/ai/client', () => ({ completion: vi.fn() }));
vi.mock('@/server/ai/settings', () => ({
  getAiConfig: () => ({
    enabled: true,
    model: 'synthetic',
    baseUrl: 'http://127.0.0.1',
    apiKey: 'synthetic',
  }),
}));
afterAll(async () => {
  await db.$disconnect();
});
const row = (id: string) => ({
  paragraphId: id,
  risk: 'medium',
  quote: '',
  reason: '需核对实验条件',
  suggestion: '补充原始记录',
  revision: '',
});
const paragraphs = makeParagraphs([
  { page: null, text: '第一段测试内容\n第二段测试内容\n第三段测试内容' },
]);
it('accepts fenced/prose JSON, trailing commas and literal newlines, salvages complete items without inventing missing risk', () => {
  const raw =
    '分析结果：\n```json\n' +
    JSON.stringify({ findings: [row('p1'), row('p2'), row('p3')] })
      .replace('需核对实验条件', '需核对\n实验条件')
      .replace(/}\]}/, '},]}') +
    '\n```';
  expect(parseWorkAnalysis(raw, paragraphs)).toHaveLength(3);
  const partial =
    '{"findings":[' +
    JSON.stringify(row('p1')) +
    ',' +
    JSON.stringify(row('p2')) +
    ',{"paragraphId":"p3","reason":"unfinished';
  expect(parseWorkPartial(partial, paragraphs).map((f) => f.paragraphId)).toEqual(['p1', 'p2']);
  expect(
    parseWorkPartial(JSON.stringify({ findings: [{ ...row('p1'), risk: 'made-up' }] }), paragraphs),
  ).toHaveLength(0);
  expect(() =>
    parseWorkAnalysis(JSON.stringify({ findings: [row('p1'), row('p1')] }), paragraphs),
  ).toThrow('重复');
});
async function document(count: number) {
  return db.workDocument.create({
    data: {
      title: 'Synthetic reliability check',
      fileName: 'test.docx',
      filePath: randomUUID() + '.docx',
      fileSize: 0,
      hash: randomUUID(),
      paragraphsJson: JSON.stringify(
        makeParagraphs([
          {
            page: null,
            text: Array.from({ length: count }, (_, i) => `第 ${i + 1} 段合成测试内容。`).join(
              '\n',
            ),
          },
        ]),
      ),
    },
  });
}
it('continues past one malformed batch, saves valid items and retries only missing paragraphs on the next run', async () => {
  const doc = await document(6),
    mock = vi.mocked(completion),
    requested: string[][] = [];
  mock.mockReset();
  mock.mockImplementation(async (messages) => {
    const ids = (JSON.parse(messages[1].content as string).paragraphs as WorkParagraph[]).map(
      (p) => p.id,
    );
    requested.push(ids);
    const text =
      requested.length === 1
        ? '{"findings":[' + JSON.stringify(row('p1')) + ',' + JSON.stringify(row('p2')) + ','
        : requested.length === 2
          ? 'not JSON'
          : JSON.stringify({ findings: ids.map(row) });
    return { text, tokens: 1 };
  });
  try {
    let job = await beginWork(doc.id, workTaskInput.parse({ kind: 'aigc' }));
    await job.run();
    let task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } }),
      result = JSON.parse(task.resultsJson);
    expect(task.status).toBe('complete');
    expect(result.failedParagraphs).toBe(1);
    expect(
      result.findings.find((f: { paragraphId: string }) => f.paragraphId === 'p3'),
    ).toMatchObject({ risk: 'unknown', retryable: true });
    job = await beginWork(doc.id, workTaskInput.parse({ kind: 'aigc' }));
    await job.run();
    task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } });
    result = JSON.parse(task.resultsJson);
    expect(result.failedParagraphs).toBe(0);
    expect(result.findings).toHaveLength(6);
    expect(requested).toEqual([['p1', 'p2', 'p3'], ['p3'], ['p4', 'p5', 'p6'], ['p3']]);
  } finally {
    await db.workDocument.delete({ where: { id: doc.id } });
  }
});
it('stops after two completely unusable batches instead of issuing repairs across the entire document', async () => {
  const doc = await document(15),
    mock = vi.mocked(completion);
  mock.mockReset();
  mock.mockResolvedValue({ text: 'invalid', tokens: 0 });
  try {
    const job = await beginWork(doc.id, workTaskInput.parse({ kind: 'aigc' }));
    await job.run();
    const task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } });
    expect(task.status).toBe('failed');
    expect(task.error).toContain('连续两批');
    expect(mock).toHaveBeenCalledTimes(4);
  } finally {
    await db.workDocument.delete({ where: { id: doc.id } });
  }
});
