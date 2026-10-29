import { createHash, randomUUID } from 'node:crypto';
import { reportDefinitions, type ReportSection } from '@/lib/types';
import { modelSectionSchema } from '@/lib/validation';
import { splitPages, verifyEvidence } from '@/lib/chunks';
import { db } from '../db';
import { getPages, requirePaper } from '../papers';
import { aiChunkChars, aiMaxInput } from '../config';
import { ApiError } from '../http';
import { completion, evidenceInstruction, requireAi } from './client';
import { getAiConfig } from './settings';
import { supportsVisionModel } from '@/lib/ai-models';
import { visualSummaries } from './vision';

interface Job {
  controller: AbortController;
  promise: Promise<void>;
}
const globalJobs = globalThis as unknown as { reportJobs?: Map<string, Job> };
const jobs = (globalJobs.reportJobs ??= new Map());
export async function cancelReport(id: string) {
  const job = jobs.get(id);
  job?.controller.abort();
  await job?.promise;
}
export async function recoverInterrupted(id: string) {
  if (!jobs.has(id))
    await db.insightReport.updateMany({
      where: { paperId: id, status: 'running' },
      data: {
        status: 'failed',
        error: '上次任务因服务重启而中断。点击继续解读，将复用已保存的分段和板块。',
        progress: '等待继续',
      },
    });
}
export function startReport(id: string, force = false): Promise<void> {
  const existing = jobs.get(id);
  if (existing) return existing.promise;
  requireAi();
  const controller = new AbortController();
  // Deferring run prevents a first await from racing registration in the map.
  const promise = Promise.resolve()
    .then(() => runReport(id, force, controller.signal))
    .finally(() => {
      jobs.delete(id);
    });
  jobs.set(id, { controller, promise });
  return promise;
}
export async function runReport(id: string, force: boolean, signal: AbortSignal) {
  const runId = randomUUID();
  const config = getAiConfig();
  const { model: modelName, baseUrl } = config;
  try {
    const paper = await requirePaper(id);
    if (paper.report?.status === 'complete' && !force) return;
    let sections: ReportSection[] = force
      ? []
      : (JSON.parse(paper.report?.sectionsJson || '[]') as ReportSection[]);
    await db.insightReport.upsert({
      where: { paperId: id },
      create: { paperId: id, status: 'running', model: modelName, runId },
      update: {
        status: 'running',
        error: '',
        runId,
        model: modelName,
        sectionsJson: JSON.stringify(sections),
        ...(force ? { version: { increment: 1 } } : {}),
      },
    });
    const progress = async (message: string) => {
      signal.throwIfAborted();
      await db.insightReport.update({ where: { paperId: id }, data: { progress: message } });
    };
    await progress('正在本机提取 PDF 文本，不上传 PDF 文件…');
    const vision = supportsVisionModel(config.model);
    const pages = await getPages(id, vision);
    const budget = Math.min(aiChunkChars, Math.max(500, aiMaxInput - 2500));
    const chunks = splitPages(pages, budget);
    const summarize = async (input: string, label: string): Promise<string> => {
      signal.throwIfAborted();
      const cacheKey = createHash('sha256')
        .update(JSON.stringify(['summary-v2', modelName, baseUrl, input]))
        .digest('hex');
      const cached = await db.chunkCache.findUnique({
        where: { paperId_cacheKey: { paperId: id, cacheKey } },
      });
      if (cached) {
        await progress(`${label} · 复用本地缓存`);
        return cached.content;
      }
      await progress(label);
      const result = await completion(
        [
          {
            role: 'system',
            content: `${evidenceInstruction}\nTASK: CHUNK_SUMMARY\n用中文提取问题、背景、方法、数据、结论、贡献、局限、术语和章节结构；保留页码及2~4条短原文引句。总长度不超过900字符。`,
          },
          { role: 'user', content: input },
        ],
        signal,
        900,
        config,
      );
      // The bounded result ensures recursive reduction shrinks regardless of provider compliance.
      const content = result.text.slice(0, 1800);
      await db.$transaction([
        db.chunkCache.upsert({
          where: { paperId_cacheKey: { paperId: id, cacheKey } },
          create: { paperId: id, cacheKey, content, tokens: result.tokens },
          update: {},
        }),
        db.insightReport.update({
          where: { paperId: id },
          data: { tokenUsage: { increment: result.tokens } },
        }),
      ]);
      return content;
    };
    let context: string;
    if (chunks.length === 1 && !vision) context = chunks[0];
    else {
      let summaries: string[] = [];
      for (let index = 0; index < chunks.length; index++)
        summaries.push(
          await summarize(chunks[index], `正在解读分段 ${index + 1} / ${chunks.length}`),
        );
      if (vision) summaries.push(...(await visualSummaries(paper, config, signal, progress)));
      let level = 1;
      const mergeBudget = Math.max(4000, budget);
      while (summaries.join('\n\n').length > mergeBudget) {
        // Preserve original page markers. Reduction groups are not PDF pages.
        const joined = summaries.join('\n\n');
        const grouped: string[] = [];
        for (let offset = 0; offset < joined.length; offset += mergeBudget)
          grouped.push(joined.slice(offset, offset + mergeBudget));
        const next: string[] = [];
        for (let i = 0; i < grouped.length; i++)
          next.push(
            await summarize(
              grouped[i],
              `正在合并分段摘要 · 第 ${level} 层 ${i + 1} / ${grouped.length}`,
            ),
          );
        summaries = next;
        level++;
      }
      context = summaries.join('\n\n');
    }
    for (const [key, title] of reportDefinitions) {
      if (sections.some((section) => section.key === key)) continue;
      await progress(`正在生成「${title}」 · ${sections.length + 1} / 10`);
      const count = key === 'terms' ? '5~10' : key === 'questions' ? '3~5' : '2~5';
      const result = await completion(
        [
          {
            role: 'system',
            content: `${evidenceInstruction}\nTASK: REPORT_SECTION ${key}\n生成中文文献解读的「${title}」板块。先一句话结论，再给${count}个通俗要点。术语板块每条包含术语及通俗定义；追问板块给可继续研究的问题。只输出JSON：{"conclusion":"结论","points":[{"text":"要点","page":1,"quote":"对应页的短原文"}]}。没有确定页码用null，没有逐字依据则quote留空并明确“不确定”。`,
          },
          {
            role: 'user',
            content: `文献：${paper.title}\n总页数：${pages.length}\n资料如下：\n${context}`,
          },
        ],
        signal,
        undefined,
        config,
      );
      let parsed;
      try {
        parsed = modelSectionSchema.parse(
          JSON.parse(result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')),
        );
      } catch {
        throw new ApiError(502, `「${title}」返回的结构无效，点击继续解读重试；其他板块已缓存`);
      }
      const maximum = key === 'terms' ? 10 : 5;
      const points = parsed.points.slice(0, maximum);
      if (!points.length)
        points.push({ text: '未提取到可靠要点，请核对原文（不确定）。', page: null, quote: '' });
      const section: ReportSection = {
        key,
        title,
        conclusion: parsed.conclusion,
        points: points.map((point) => verifyEvidence(point, pages)),
      };
      sections = [...sections, section];
      await db.insightReport.update({
        where: { paperId: id },
        data: { sectionsJson: JSON.stringify(sections), tokenUsage: { increment: result.tokens } },
      });
    }
    await progress('10 个板块已完成，报告已保存到本机');
    await db.insightReport.update({ where: { paperId: id }, data: { status: 'complete' } });
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : signal.aborted
          ? '任务已停止，可继续解读'
          : '解读中断，请重试；已完成的分段与板块仍保留';
    await db.insightReport
      .updateMany({ where: { paperId: id }, data: { status: 'failed', error: message } })
      .catch(() => undefined);
  }
}
