import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db } from '../db';
import { safeFilePath } from '../storage';
import { renderPageImages } from '../pdf';
import { completion, evidenceInstruction, type Message } from './client';
import type { getAiConfig } from './settings';

export async function visualSummaries(
  paper: { id: string; filePath: string; pageCount: number },
  config: ReturnType<typeof getAiConfig>,
  signal: AbortSignal,
  progress: (message: string) => Promise<void>,
) {
  const summaries: string[] = [];
  let bytes: Buffer | undefined;
  for (let offset = 0; offset < paper.pageCount; offset += 4) {
    signal.throwIfAborted();
    const numbers = Array.from(
      { length: Math.min(4, paper.pageCount - offset) },
      (_, i) => offset + i + 1,
    );
    const key = createHash('sha256')
      .update(JSON.stringify(['visual-v1', config.model, config.baseUrl, paper.filePath, numbers]))
      .digest('hex');
    const cached = await db.chunkCache.findUnique({
      where: { paperId_cacheKey: { paperId: paper.id, cacheKey: key } },
    });
    await progress(
      `图文解读 · 第 ${numbers[0]}–${numbers.at(-1)} 页${cached ? ' · 复用缓存' : ''}`,
    );
    if (cached) {
      summaries.push(cached.content);
      continue;
    }
    bytes ??= await readFile(safeFilePath(paper.filePath));
    const images = await renderPageImages(bytes, numbers);
    const content: Message['content'] = [
      {
        type: 'text',
        text: '以下为 PDF 页面图像。只提取图表、表格、公式、实验照片及扫描文字的关键信息，标注各自 [p.N]；不要猜测模糊刻度或未展示信息，不确定请明说。900 个中文字符以内。',
      },
    ];
    for (const image of images)
      content.push(
        { type: 'text', text: `[p.${image.page}]` },
        { type: 'image_url', image_url: { url: image.url } },
      );
    const result = await completion(
      [
        { role: 'system', content: `${evidenceInstruction}\nTASK: VISUAL_SUMMARY` },
        { role: 'user', content },
      ],
      signal,
      1500,
      config,
    );
    const summary = result.text.slice(0, 1800);
    await db.$transaction([
      db.chunkCache.upsert({
        where: { paperId_cacheKey: { paperId: paper.id, cacheKey: key } },
        create: { paperId: paper.id, cacheKey: key, content: summary, tokens: result.tokens },
        update: {},
      }),
      db.insightReport.update({
        where: { paperId: paper.id },
        data: { tokenUsage: { increment: result.tokens } },
      }),
    ]);
    summaries.push(summary);
  }
  return summaries;
}
