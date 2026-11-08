import { afterAll, describe, expect, it, vi } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import { db } from '@/server/db';
import { makeDocx, makePdf } from './fixtures';
import {
  calculateSimilarity,
  findLiteralMatches,
  makeParagraphs,
  type WorkParagraph,
} from '@/lib/work';
import { validateDocxZip, workFile } from '@/server/work/documents';
import { publicAddress, extractSourceText, publicFetch } from '@/server/work/sources';
import { workHandler } from '@/app/api/work/[[...path]]/route';
import { beginWork, parseWorkAnalysis, workTaskInput } from '@/server/work/tasks';
import { completion } from '@/server/ai/client';
vi.mock('next/server', () => ({ after: () => undefined }));
vi.mock('@/server/ai/client', () => ({ completion: vi.fn() }));
vi.mock('@/server/ai/settings', () => ({
  getAiConfig: () => ({
    enabled: true,
    model: 'mock-work',
    baseUrl: 'http://127.0.0.1:4123/v1',
    apiKey: 'synthetic-test-key',
  }),
}));
const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const call = (method: string, path: string[], body?: unknown) =>
  workHandler(
    new Request('http://localhost/api/work/' + path.join('/'), {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    context(...path),
  );
afterAll(async () => {
  await db.$disconnect();
});
describe('Work integrity and useful reports', () => {
  it('counts overlapping matches once, excludes reference sections and keeps correct literal positions', () => {
    const text = '这是一段用于检验公开来源文字匹配的真实测试句子，数据与术语应保持不变。';
    const paragraphs = makeParagraphs([{ page: 1, text: text + '\n参考文献\n' + text }]);
    const matched = findLiteralMatches(text, '前缀 ' + text + ' 后缀');
    expect(matched).toHaveLength(1);
    expect(text.slice(matched[0].start, matched[0].end)).toBe(text.slice(0, -1));
    const matches = [...matched, ...matched].map((m) => ({
      ...m,
      paragraphId: 'p1',
      sourceId: 'source',
      sourceTitle: 'Source',
      url: 'https://example.org',
    }));
    expect(calculateSimilarity(paragraphs, matches, true).percentage).toBe(100);
    expect(calculateSimilarity(paragraphs, matches, false).percentage).toBeLessThan(100);
    expect(calculateSimilarity(paragraphs, matches, true).excludedCharacters).toBeGreaterThan(0);
  });
  it('rejects private sources and oversized DOCX archives; extracts text without executing HTML', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '172.16.1.2',
      '192.168.1.1',
      '::1',
      '::ffff:127.0.0.1',
      'fe80::1',
    ])
      expect(publicAddress(address)).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
    await expect(publicFetch('file:///C:/Windows/win.ini')).rejects.toThrow();
    const source = extractSourceText(
      Buffer.from(
        `<article><script>alert(1)</script><p>${'Readable safe text. '.repeat(10)}</p></article>`,
      ),
      'text/html',
    );
    expect(source.text).not.toContain('alert');
    const bytes = await makeDocx(['测试稿件中的一段文字。']);
    validateDocxZip(bytes);
    const bomb = Buffer.from(bytes);
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(90 * 1024 * 1024, central + 24);
    expect(() => validateDocxZip(bomb)).toThrow('解压内容过大');
    expect(() => workFile('../../secret.docx')).toThrow();
  });
  it('anchors model output to actual text, never fabricates quoted locations', () => {
    const paragraphs = [
      { id: 'p1', page: null, heading: '正文', text: '原始文字，只能在这里定位。' },
    ] satisfies WorkParagraph[];
    const findings = parseWorkAnalysis(
      JSON.stringify({
        findings: [
          {
            paragraphId: 'p1',
            risk: 'medium',
            quote: '不存在的句子',
            reason: '需核对',
            suggestion: '补充证据',
          },
        ],
      }),
      paragraphs,
    );
    expect(findings[0].quote).toBe(paragraphs[0].text);
    expect(findings[0].reason).toContain('仅定位本段');
    expect(() => parseWorkAnalysis('{"findings":[]}', paragraphs)).toThrow('遗漏');
  });
  it('imports real DOCX/PDF, persists reports, resumes paid segments from cache and removes files/data', async () => {
    const file = await makeDocx(
      Array.from(
        { length: 7 },
        (_, i) =>
          `第 ${i + 1} 段：这是本地自动化测试中的独立稿件内容，研究事实、单位与引用必须保持不变。`,
      ),
    );
    const upload = () => {
      const form = new FormData();
      form.set(
        'file',
        new File([new Uint8Array(file)], '真实测试稿件.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
      return workHandler(
        new Request('http://localhost/api/work', { method: 'POST', body: form }),
        context(),
      );
    };
    const response = await upload();
    expect(response.status).toBe(201);
    const doc = await response.json();
    try {
      expect((await (await upload()).json()).id).toBe(doc.id);
      expect((await readFile(workFile(doc.filePath))).equals(file)).toBe(true);
      expect(JSON.parse(doc.paragraphsJson)).toHaveLength(7);
      const mock = vi.mocked(completion);
      let count = 0;
      mock.mockImplementation(async (messages) => {
        count++;
        if (count === 2) throw new Error('synthetic failure');
        const user = JSON.parse(messages[1].content as string);
        return {
          text: JSON.stringify({
            findings: user.paragraphs.map((p: WorkParagraph) => ({
              paragraphId: p.id,
              risk: 'medium',
              quote: p.text.slice(0, 20),
              reason: '测试原因',
              suggestion: '测试建议',
              revision: '',
            })),
          }),
          tokens: 100,
        };
      });
      let job = await beginWork(doc.id, workTaskInput.parse({ kind: 'aigc' }));
      await job.run();
      let task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } });
      expect(task.status).toBe('failed');
      expect(JSON.parse(task.resultsJson).checkedParagraphs).toBe(3);
      job = await beginWork(doc.id, workTaskInput.parse({ kind: 'aigc' }));
      await job.run();
      task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } });
      expect(task.status).toBe('complete');
      expect(count).toBe(4);
      expect(JSON.parse(task.resultsJson).findings).toHaveLength(7);
      const paragraphs = JSON.parse(doc.paragraphsJson) as WorkParagraph[];
      await db.workSource.create({
        data: {
          documentId: doc.id,
          title: 'Synthetic public source',
          url: 'https://example.org/synthetic',
          text: paragraphs.map((p) => p.text).join('\n'),
        },
      });
      job = await beginWork(doc.id, workTaskInput.parse({ kind: 'similarity', discover: false }));
      await job.run();
      task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } });
      expect(JSON.parse(task.resultsJson).percentage).toBe(100);
      const detail = await (await call('GET', [doc.id])).json();
      expect(detail.tasks.length).toBe(3);
      expect(detail.sources).toHaveLength(1);
      expect(detail).not.toHaveProperty('filePath');
      const changed = await call('PATCH', [doc.id], { title: '新的稿件名称' });
      expect(changed.status).toBe(200);
      const crossSite = await workHandler(
        new Request('http://localhost/api/work/' + doc.id, {
          method: 'DELETE',
          headers: { origin: 'https://evil.example' },
        }),
        context(doc.id),
      );
      expect(crossSite.status).toBe(403);
    } finally {
      expect((await call('DELETE', [doc.id])).status).toBe(200);
    }
    await expect(access(workFile(doc.filePath))).rejects.toThrow();
    expect(await db.workCache.count({ where: { documentId: doc.id } })).toBe(0);
    const pdf = await makePdf('Work PDF', 1),
      form = new FormData();
    form.set('file', new File([new Uint8Array(pdf)], 'work.pdf', { type: 'application/pdf' }));
    const pdfResponse = await workHandler(
      new Request('http://localhost/api/work', { method: 'POST', body: form }),
      context(),
    );
    expect(pdfResponse.status).toBe(201);
    const paper = await pdfResponse.json();
    expect(JSON.parse(paper.paragraphsJson)[0].page).toBe(1);
    await call('DELETE', [paper.id]);
  });
});
