import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { dataDir } from '../config';
import { ApiError } from '../http';
import { extractPages } from '../pdf';
import { makeParagraphs } from '@/lib/work';
export const workDir = path.join(dataDir, 'work');
export function workFile(name: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|docx)$/.test(name)) throw new ApiError(400, '稿件路径无效');
  return path.join(workDir, name);
}
export async function boundedBytes(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit)
    throw new ApiError(413, '稿件不能超过 20 MiB');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '缺少上传内容');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError(413, '稿件不能超过 20 MiB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export function validateDocxZip(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > bytes.length) throw new ApiError(422, 'DOCX 文件结构损坏');
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16),
    total = 0;
  let hasDocument = false;
  if (count > 4000 || count === 65535) throw new ApiError(413, 'DOCX 包含过多内容');
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new ApiError(422, 'DOCX 目录损坏');
    const size = bytes.readUInt32LE(cursor + 24),
      len = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32);
    if (bytes.readUInt16LE(cursor + 8) & 1) throw new ApiError(422, '请先解除 Word 文件密码');
    total += size;
    if (total > 64 * 1024 * 1024) throw new ApiError(413, 'DOCX 解压内容过大');
    const name = bytes.subarray(cursor + 46, cursor + 46 + len).toString('utf8');
    if (name === 'word/document.xml') hasDocument = true;
    cursor += 46 + len + extra + comment;
  }
  if (!hasDocument) throw new ApiError(422, '文件不是有效的 DOCX 文档');
}
export async function importWork(request: Request) {
  const bytes = await boundedBytes(request, 20 * 1024 * 1024 + 128 * 1024);
  let form: FormData;
  try {
    form = await new Response(bytes, {
      headers: { 'content-type': request.headers.get('content-type') || '' },
    }).formData();
  } catch {
    throw new ApiError(400, '上传请求无效');
  }
  const file = form.get('file');
  if (!(file instanceof File) || form.getAll('file').length !== 1)
    throw new ApiError(400, '请选择一个 DOCX 或 PDF');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new ApiError(413, '文件为空或超过 20 MiB');
  const name = path.basename(file.name.replaceAll('\\', '/')).slice(0, 240),
    ext = path.extname(name).toLowerCase();
  if (!['.docx', '.pdf'].includes(ext))
    throw new ApiError(400, '支持 DOCX、PDF；旧版 DOC 请先在 Word 另存为 DOCX');
  const allowed =
    ext === '.pdf'
      ? ['application/pdf', 'application/octet-stream']
      : [
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/octet-stream',
          'application/zip',
        ];
  if (!allowed.includes(file.type)) throw new ApiError(400, '文件类型与扩展名不符');
  const buffer = Buffer.from(await file.arrayBuffer()),
    hash = createHash('sha256').update(buffer).digest('hex');
  const existing = await db.workDocument.findUnique({ where: { hash } });
  if (existing) return existing;
  let pages: { text: string; page: number | null }[];
  if (ext === '.pdf') {
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new ApiError(422, '无效的 PDF');
    pages = await extractPages(buffer);
  } else {
    validateDocxZip(buffer);
    try {
      const result = await mammoth.extractRawText({ buffer });
      pages = [{ text: result.value, page: null }];
    } catch {
      throw new ApiError(422, '无法解析 DOCX，请检查文件是否损坏');
    }
  }
  const paragraphs = makeParagraphs(pages),
    length = paragraphs.reduce((n, p) => n + p.text.length, 0);
  if (length < 20) throw new ApiError(422, '稿件没有足够的可提取正文，扫描 PDF 请先进行 OCR');
  if (length > 250000 || paragraphs.length > 1000)
    throw new ApiError(413, '稿件过长，请按章节拆分后导入（最多 25 万字符）');
  await mkdir(workDir, { recursive: true });
  const filePath = randomUUID() + ext,
    temporary = workFile(filePath) + '.part';
  try {
    await writeFile(temporary, buffer, { flag: 'wx' });
    await rename(temporary, workFile(filePath));
    return await db.workDocument.create({
      data: {
        title: name.replace(/\.(pdf|docx)$/i, ''),
        fileName: name,
        filePath,
        fileSize: file.size,
        hash,
        paragraphsJson: JSON.stringify(paragraphs),
      },
    });
  } catch (error) {
    await rm(workFile(filePath), { force: true });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return db.workDocument.findUniqueOrThrow({ where: { hash } });
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function drainWorkFiles() {
  const pending = await db.fileDeletion.findMany({ where: { path: { startsWith: 'work/' } } });
  for (const item of pending) {
    await rm(workFile(item.path.slice(5)), { force: true });
    await db.fileDeletion.deleteMany({ where: { path: item.path } });
  }
}
export async function requireWork(id: string) {
  const doc = await db.workDocument.findUnique({ where: { id } });
  if (!doc) throw new ApiError(404, '稿件不存在');
  return doc;
}
export async function readWorkOriginal(id: string) {
  return readFile(workFile((await requireWork(id)).filePath));
}
