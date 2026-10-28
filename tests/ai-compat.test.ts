import { afterAll, expect, it, vi } from 'vitest';
import { parseCompletion, readCompletion } from '@/server/ai/response';
import { completion } from '@/server/ai/client';
import { renderPageImages } from '@/server/pdf';
import { visualSummaries } from '@/server/ai/vision';
import { db } from '@/server/db';
import { makePdf } from './fixtures';
import { mkdir, writeFile } from 'node:fs/promises';
import { safeFilePath } from '@/server/storage';
import { uploadDir } from '@/server/config';
afterAll(async () => {
  await db.$disconnect();
});
it('reads text content blocks and never substitutes private reasoning for final answers', () => {
  expect(
    parseCompletion({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: '结论' },
              { type: 'text', text: '要点' },
            ],
          },
        },
      ],
    }).text,
  ).toBe('结论\n要点');
  expect(() =>
    parseCompletion({
      choices: [
        {
          message: { content: null, reasoning_content: 'private thought' },
          finish_reason: 'length',
        },
      ],
    }),
  ).toThrow('输出上限');
  expect(() =>
    parseCompletion({
      choices: [
        { message: { content: null, reasoning_content: 'private thought' }, finish_reason: 'stop' },
      ],
    }),
  ).toThrow('没有最终回答');
  expect(() =>
    parseCompletion({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }),
  ).toThrow('未生成完整答案');
});
it('accepts SSE responses from gateways even when non-stream JSON was requested', async () => {
  const response = new Response(
    'data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n\ndata: {"choices":[{"delta":{"content":"完整回答"},"finish_reason":"stop"}],"usage":{"total_tokens":32}}\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
  expect(await readCompletion(response)).toEqual({ text: '完整回答', tokens: 32 });
});
it('reserves a bounded combined reasoning/output budget for GLM 5.3 without disabling thinking', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(Response.json({ choices: [{ message: { content: '正常' } }] }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    await completion([{ role: 'user', content: '问题' }], undefined, 900, {
      enabled: true,
      apiKey: 'test',
      model: 'GLM-5.3-Flash',
      baseUrl: 'https://example.com/v1',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.max_tokens).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
it('renders actual PDF pages as JPEGs and caches visual summaries without repeating requests', async () => {
  const bytes = await makePdf('Visual fixture', 2),
    images = await renderPageImages(bytes, [1, 2]);
  expect(images).toHaveLength(2);
  expect(images[0].url).toMatch(/^data:image\/jpeg;base64,/);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(safeFilePath('11111111-1111-4111-8111-111111111111.pdf'), bytes);
  const paper = await db.paper.create({
    data: {
      title: 'Visual fixture',
      fileName: 'visual.pdf',
      filePath: '11111111-1111-4111-8111-111111111111.pdf',
      fileSize: bytes.length,
      pageCount: 2,
      report: { create: {} },
    },
  });
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      choices: [{ message: { content: '[p.1] 图像证据。不确定部分已标明。' } }],
      usage: { total_tokens: 42 },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  try {
    const config = {
        enabled: true,
        apiKey: 'test',
        model: 'GLM-5.3-Flash',
        baseUrl: 'https://example.com/v1',
      },
      signal = new AbortController().signal,
      progress = async () => {};
    await visualSummaries(paper, config, signal, progress);
    await visualSummaries(paper, config, signal, progress);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(
      body.messages[1].content.filter((part: { type: string }) => part.type === 'image_url'),
    ).toHaveLength(2);
    expect(
      (await db.insightReport.findUniqueOrThrow({ where: { paperId: paper.id } })).tokenUsage,
    ).toBe(42);
  } finally {
    vi.unstubAllGlobals();
  }
});
