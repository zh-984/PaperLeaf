import type { InsightReport as DbReport, Paper as DbPaper } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import type { InsightReport, PageText, Paper, ReportSection, ReportStatus } from '@/lib/types';
import { db } from './db';
import { ApiError } from './http';
import { safeFilePath } from './storage';
import { extractPages } from './pdf';
import { repairPaperTitle } from './repair-titles';

export function reportDto(report: DbReport): InsightReport {
  return {
    status: report.status as ReportStatus,
    sections: JSON.parse(report.sectionsJson) as ReportSection[],
    progress: report.progress,
    error: report.error,
    model: report.model,
    tokenUsage: report.tokenUsage,
    version: report.version,
    updatedAt: report.updatedAt.toISOString(),
  };
}
export function paperDto(paper: DbPaper & { report: DbReport | null }): Paper {
  return {
    id: paper.id,
    title: paper.title,
    fileName: paper.fileName,
    fileSize: paper.fileSize,
    pageCount: paper.pageCount,
    lastPage: paper.lastPage,
    lastPosition: paper.lastPosition,
    shelfId: paper.shelfId,
    createdAt: paper.createdAt.toISOString(),
    updatedAt: paper.updatedAt.toISOString(),
    report: paper.report ? reportDto(paper.report) : null,
  };
}
export async function requirePaper(id: string) {
  const paper = await db.paper.findUnique({ where: { id }, include: { report: true } });
  if (!paper) throw new ApiError(404, '文献不存在或已被删除');
  return repairPaperTitle(paper);
}
const globalExtraction = globalThis as unknown as {
  extractions?: Map<string, Promise<PageText[]>>;
};
const extractions = (globalExtraction.extractions ??= new Map());
export async function getPages(id: string, allowScanned = false): Promise<PageText[]> {
  const paper = await requirePaper(id);
  const stored = JSON.parse(paper.textJson) as PageText[];
  const usable = (pages: PageText[]) => {
    if (!allowScanned && pages.reduce((sum, page) => sum + page.text.trim().length, 0) < 20)
      throw new ApiError(
        422,
        '文献没有可提取文字，请配置支持图像输入的模型后解读；原文阅读仍可使用',
      );
    return pages;
  };
  if (stored.length) return usable(stored);
  const existing = extractions.get(id);
  if (existing) return usable(await existing);
  const task = (async () => {
    const pages = await extractPages(await readFile(safeFilePath(paper.filePath)), true);
    await db.paper.update({ where: { id }, data: { textJson: JSON.stringify(pages) } });
    return pages;
  })();
  extractions.set(id, task);
  try {
    return usable(await task);
  } finally {
    extractions.delete(id);
  }
}
