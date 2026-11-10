import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db';
import { analyzeGroup } from './analysis';
export { parseWorkAnalysis } from './analysis';
import { getAiConfig } from '../ai/settings';
import { ApiError } from '../http';
import { requireWork } from './documents';
import { addSource, discoverSources } from './sources';
import { sourceError } from './discovery';
import { getWorkDetector } from './detector';
import {
  localDetectorState,
  LOCAL_MODEL_NAME,
  LOCAL_MODEL_REVISION,
  localFindings,
} from './local-detector';
import {
  calculateSimilarity,
  createLiteralMatcher,
  isReferenceParagraph,
  type WorkFinding,
  type WorkParagraph,
  type WorkResults,
  type WorkMatch,
} from '@/lib/work';

const shared = globalThis as unknown as { workJobs?: Map<string, AbortController> };
const jobs = (shared.workJobs ??= new Map());
export const workTaskInput = z.object({
  kind: z.enum(['aigc', 'similarity']),
  aiSlot: z.number().int().min(1).max(3).default(1),
  force: z.boolean().default(false),
  excludeReferences: z.boolean().default(true),
  discover: z.boolean().default(true),
  query: z.string().trim().max(250).default(''),
  engine: z.enum(['assistant', 'detector', 'local']).default('assistant'),
});
type Input = z.infer<typeof workTaskInput>;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export async function recoverWork(documentId?: string) {
  const running = await db.workTask.findMany({
    where: { ...(documentId ? { documentId } : {}), status: 'running' },
  });
  for (const task of running)
    if (!jobs.has(task.id))
      await db.workTask.updateMany({
        where: { id: task.id, status: 'running' },
        data: { status: 'failed', error: '应用重启或任务中断，已保存结果；点击继续可复用缓存' },
      });
}
export function cancelWork(id: string) {
  jobs.get(id)?.abort();
}
export async function beginWork(documentId: string, input: Input) {
  await requireWork(documentId);
  await recoverWork(documentId);
  const running = await db.workTask.findFirst({ where: { documentId, status: 'running' } });
  if (running) throw new ApiError(409, '此稿件已有任务进行中，请等待或取消');
  if (jobs.size >= 2) throw new ApiError(429, '最多同时检查两篇稿件，请稍候');
  if (input.kind === 'aigc' && input.engine === 'assistant' && !getAiConfig(input.aiSlot).enabled)
    throw new ApiError(503, '未配置 AI，请在设置与隐私中填写 API 地址、Key 和模型');
  if (input.kind === 'aigc' && input.engine === 'detector' && !getWorkDetector().url)
    throw new ApiError(503, '未配置专用检测器接口，仍可选择 AI 辅助分析');
  if (input.kind === 'aigc' && input.engine === 'local' && !localDetectorState().ready)
    throw new ApiError(503, '本地检测模型尚未准备好，请先下载');
  const task = await db.workTask.create({
    data: {
      documentId,
      kind: input.kind,
      paramsJson: JSON.stringify(input),
      progress: '准备检查…',
    },
  });
  const controller = new AbortController();
  jobs.set(task.id, controller);
  return { task, run: () => runWork(task.id, documentId, input, controller) };
}
async function runWork(
  taskId: string,
  documentId: string,
  input: Input,
  controller: AbortController,
) {
  const signal = controller.signal;
  const save = async (results: WorkResults, progress: string) => {
    signal.throwIfAborted();
    await db.workTask.updateMany({
      where: { id: taskId, status: 'running' },
      data: { resultsJson: JSON.stringify(results), progress },
    });
  };
  let results: WorkResults = {};
  try {
    const doc = await requireWork(documentId);
    const paragraphs = JSON.parse(doc.paragraphsJson) as WorkParagraph[];
    const included = paragraphs.filter((p) => !input.excludeReferences || !isReferenceParagraph(p));
    if (!included.length) throw new ApiError(422, '排除参考文献后没有可检查正文');
    if (input.kind === 'aigc') {
      const config = getAiConfig(input.aiSlot);
      const detectorConfig = getWorkDetector();
      const detectorUrl = detectorConfig.url,
        detectorKey = detectorConfig.key;
      results = {
        findings: [],
        checkedParagraphs: 0,
        totalParagraphs: included.length,
        engine: input.engine,
        model:
          input.engine === 'local'
            ? LOCAL_MODEL_NAME
            : input.engine === 'assistant'
              ? config.model
              : detectorConfig.model || '专用检测器',
        warnings:
          input.engine === 'assistant'
            ? ['AI 辅助分析是表达风险判断，不证明作者身份，也不输出真实 AI 写作比例。']
            : ['专用检测器分数仅供参考，不同检测器的分数不可直接换算。'],
      };
      await save(results, '开始逐段分析…');
      let consecutiveFormatFailures = 0;
      for (let index = 0; index < included.length; index += 3) {
        signal.throwIfAborted();
        const group = included.slice(index, index + 3);
        const context = {
          previous: included[index - 1]?.text.slice(-400) || '',
          paragraphs: group,
          next: included[index + 3]?.text.slice(0, 400) || '',
        };
        const cacheKey = digest(
          input.engine === 'local'
            ? 'work-local-v1' + JSON.stringify({ context, revision: LOCAL_MODEL_REVISION })
            : 'work-analysis-v2' +
                JSON.stringify({
                  context,
                  engine: input.engine,
                  model: config.model,
                  base: config.baseUrl,
                  key: config.apiKey,
                  detectorUrl,
                  detectorKey,
                  detectorModel: detectorConfig.model,
                }),
        );
        const cached =
          !input.force &&
          (await db.workCache.findUnique({
            where: { documentId_key: { documentId, key: cacheKey } },
          }));
        let findings: WorkFinding[];
        if (cached) findings = JSON.parse(cached.content) as WorkFinding[];
        else if (input.engine === 'local') {
          findings = await localFindings(group, signal);
        } else if (input.engine === 'assistant') {
          const perItemKey = (id: string) => digest('work-analysis-item-v1' + cacheKey + id);
          const restored: WorkFinding[] = [];
          if (!input.force)
            for (const paragraph of group) {
              const item = await db.workCache.findUnique({
                where: { documentId_key: { documentId, key: perItemKey(paragraph.id) } },
              });
              if (item) restored.push(JSON.parse(item.content) as WorkFinding);
            }
          const missing = group.filter((p) => !restored.some((f) => f.paragraphId === p.id));
          const generated = missing.length
            ? await analyzeGroup(
                { ...context, paragraphs: missing },
                config,
                signal,
                async (accepted) => {
                  for (const finding of accepted)
                    await db.workCache.upsert({
                      where: {
                        documentId_key: { documentId, key: perItemKey(finding.paragraphId) },
                      },
                      create: {
                        documentId,
                        key: perItemKey(finding.paragraphId),
                        content: JSON.stringify(finding),
                      },
                      update: { content: JSON.stringify(finding) },
                    });
                },
              )
            : [];
          findings = group.map((p) =>
            [...restored, ...generated].find((f) => f.paragraphId === p.id)!,
          );
        } else {
          const endpoint = new URL(detectorUrl);
          if (!['http:', 'https:'].includes(endpoint.protocol))
            throw new ApiError(400, '专用检测器地址无效');
          const response = await fetch(endpoint, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
            headers: {
              'Content-Type': 'application/json',
              ...(detectorKey ? { Authorization: `Bearer ${detectorKey}` } : {}),
            },
            body: JSON.stringify({
              model: detectorConfig.model || undefined,
              paragraphs: group.map((p) => ({ id: p.id, text: p.text })),
            }),
          });
          if (!response.ok) throw new ApiError(502, `专用检测器返回 HTTP ${response.status}`);
          const raw = await response.text();
          if (raw.length > 1024 * 1024) throw new ApiError(502, '检测器响应过大');
          const scores = z
            .object({
              results: z
                .array(z.object({ id: z.string(), score: z.number().min(0).max(1) }))
                .max(3),
            })
            .parse(JSON.parse(raw));
          if (
            scores.results.length !== group.length ||
            new Set(scores.results.map((s) => s.id)).size !== group.length
          )
            throw new ApiError(502, '检测器遗漏或重复段落');
          findings = group.map((p) => {
            const item = scores.results.find((s) => s.id === p.id);
            if (!item) throw new ApiError(502, '检测器段落编号无效');
            return {
              paragraphId: p.id,
              start: 0,
              end: p.text.length,
              quote: p.text,
              risk: item.score >= 0.8 ? 'high' : item.score >= 0.5 ? 'medium' : 'low',
              score: item.score,
              reason: '专用检测器模型评分；仅定位本段，并非逐字来源证明',
              suggestion: '结合原文事实、方法和引用人工核对，本结果不作为作者身份的唯一依据',
              revision: '',
            };
          });
        }
        if (!cached && !findings.some((f) => f.retryable)) {
          signal.throwIfAborted();
          await db.workCache.upsert({
            where: { documentId_key: { documentId, key: cacheKey } },
            create: { documentId, key: cacheKey, content: JSON.stringify(findings) },
            update: { content: JSON.stringify(findings) },
          });
          if (input.engine === 'assistant')
            await db.workCache.deleteMany({
              where: {
                documentId,
                key: { in: group.map((p) => digest('work-analysis-item-v1' + cacheKey + p.id)) },
              },
            });
        }
        results.findings!.push(...findings);
        results.checkedParagraphs = results.findings!.length;
        results.failedParagraphs = results.findings!.filter((f) => f.retryable).length;
        consecutiveFormatFailures = findings.every((f) => f.retryable)
          ? consecutiveFormatFailures + 1
          : 0;
        await save(
          results,
          `${results.failedParagraphs ? '已处理' : '已分析'} ${results.checkedParagraphs} / ${included.length} 段${cached ? ' · 复用缓存' : ''}${results.failedParagraphs ? ' · ' + results.failedParagraphs + ' 段待重试' : ''}`,
        );
        if (consecutiveFormatFailures >= 2)
          throw new ApiError(
            502,
            '连续两批未获得有效分析，已停止追加请求；请检查模型配置或稍后重试，成功结果已缓存。',
          );
      }
    } else {
      results = {
        matches: [],
        percentage: null,
        warnings: [],
        totalParagraphs: included.length,
        checkedParagraphs: 0,
        comparedSources: 0,
      };
      if (input.discover) {
        await save(results, '正在检索开放论文来源…');
        const networkSignal = AbortSignal.any([signal, AbortSignal.timeout(110000)]);
        const discovery = await discoverSources(input.query || doc.title, networkSignal);
        results.warnings!.push(discovery.scope, ...discovery.warnings);
        const existing = await db.workSource.findMany({ where: { documentId } });
        const knownIds = new Set(existing.map((s) => s.id));
        const diagnostics = (results.discovery = {
          queries: discovery.queries,
          providers: discovery.providers,
          candidates: discovery.candidates.length,
          fetched: 0,
          reused: 0,
          failures: [] as { title: string; url: string; reason: string }[],
        });
        await save(results, `找到 ${discovery.candidates.length} 个候选，正在读取正文…`);
        let attempts = 0;
        for (const candidate of discovery.candidates) {
          signal.throwIfAborted();
          if (
            existing.some((s) => [candidate.url, ...(candidate.alternatives || [])].includes(s.url))
          ) {
            diagnostics.reused++;
            continue;
          }
          if (
            diagnostics.fetched >= 4 ||
            attempts >= 12 ||
            knownIds.size >= 12 ||
            networkSignal.aborted
          )
            break;
          await save(results, `读取候选来源：${candidate.title.slice(0, 55)}`);
          for (const url of [candidate.url, ...(candidate.alternatives || [])].slice(0, 3)) {
            if (attempts++ >= 12 || networkSignal.aborted) break;
            try {
              const source = await addSource(documentId, url, networkSignal, candidate.title, true);
              if (!knownIds.has(source.id)) {
                diagnostics.fetched++;
                knownIds.add(source.id);
              } else diagnostics.reused++;
              break;
            } catch (error) {
              signal.throwIfAborted();
              diagnostics.failures.push({
                title: candidate.title.slice(0, 100),
                url,
                reason: sourceError(error),
              });
            }
          }
          await save(
            results,
            `已取得 ${diagnostics.fetched} 个新正文 · 复用 ${diagnostics.reused} 个来源`,
          );
        }
        if (networkSignal.aborted)
          results.warnings!.push(
            '本轮来源读取达到 110 秒上限；已取得正文仍会参与比对，可稍后补充来源再查重。',
          );
        if (!discovery.candidates.length)
          results.warnings!.push(
            '没有找到全文候选。建议用 2–5 个主题词（如 BiVO4 water splitting），或在来源管理粘贴公开全文链接。',
          );
      }
      const sources = await db.workSource.findMany({
        where: { documentId },
        orderBy: { createdAt: 'asc' },
      });
      results.comparedSources = sources.length;
      if (!sources.length) {
        results.warnings!.push(
          '未取得可比对的公开正文，无法计算重复率；请补充来源链接或调整检索词。',
        );
        await save(results, '没有取得来源，重复率未计算');
      } else {
        const matches: WorkMatch[] = [];
        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
          signal.throwIfAborted();
          const source = sources[sourceIndex];
          // Reuse one source index for all paragraphs, then release it. This
          // avoids rebuilding a large index for every paragraph or retaining
          // indexes for the entire source collection in memory.
          const matchSource = createLiteralMatcher(source.text);
          for (let index = 0; index < included.length; index++) {
            signal.throwIfAborted();
            const paragraph = included[index];
            for (const match of matchSource(paragraph.text))
              matches.push({
                ...match,
                paragraphId: paragraph.id,
                sourceId: source.id,
                sourceTitle: source.title,
                url: source.url,
              });
            results.matches = matches;
            results.checkedParagraphs = sourceIndex === sources.length - 1 ? index + 1 : 0;
            Object.assign(
              results,
              calculateSimilarity(paragraphs, matches, input.excludeReferences),
            );
            if (index % 5 === 0)
              await save(
                results,
                `来源 ${sourceIndex + 1} / ${sources.length} · 已比对 ${index + 1} / ${included.length} 段`,
              );
          }
        }
        results.warnings!.push(
          '重复率仅相对于本次取得的公开正文，采用连续文字匹配，不代表全网/知网重复率。',
        );
      }
    }
    signal.throwIfAborted();
    await db.workTask.updateMany({
      where: { id: taskId, status: 'running' },
      data: {
        status: 'complete',
        progress:
          input.kind === 'similarity' && results.percentage == null
            ? '没有取得来源 · 重复率未计算'
            : results.failedParagraphs
              ? '检查结束 · ' + results.failedParagraphs + ' 段待重试（其余已保存）'
              : '检查完成 · 已保存在本机',
        resultsJson: JSON.stringify(results),
      },
    });
  } catch (error) {
    await db.workTask
      .updateMany({
        where: { id: taskId, status: 'running' },
        data: {
          status: signal.aborted ? 'cancelled' : 'failed',
          error: signal.aborted
            ? '任务已取消，已完成结果保留'
            : error instanceof ApiError
              ? error.message
              : input.kind === 'similarity'
                ? `查重未完成：${sourceError(error)}；已保存结果保留。`
                : '检查失败，请稍后继续；已完成段落仍保留',
          resultsJson: JSON.stringify(results),
        },
      })
      .catch(() => undefined);
  } finally {
    jobs.delete(taskId);
  }
}
