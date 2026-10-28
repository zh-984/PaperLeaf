import { readFile } from 'node:fs/promises';
import { looksGarbled, repairEncoding } from '@/lib/paper-title';
import { db } from './db';
import { readMetadata } from './pdf';
import { safeFilePath } from './storage';
import type { Paper } from '@prisma/client';

export async function repairPaperTitle<T extends Paper>(paper: T): Promise<T> {
  if (!looksGarbled(paper.title) && !looksGarbled(paper.fileName)) return paper;
  const fileName = repairEncoding(paper.fileName);
  let title = repairEncoding(paper.title);
  try {
    title = (await readMetadata(await readFile(safeFilePath(paper.filePath)), fileName)).title;
  } catch {
    if (looksGarbled(title))
      title = looksGarbled(fileName) ? '未命名文献' : fileName.replace(/\.pdf$/i, '');
  }
  const updated = await db.paper.update({ where: { id: paper.id }, data: { title, fileName } });
  return { ...paper, ...updated };
}
