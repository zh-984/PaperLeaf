import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import busboy from 'busboy';
import { maxUploadBytes, maxUploadMB, tempDir, uploadDir } from './config';
import { ApiError } from './http';
import { db } from './db';
import { readMetadata } from './pdf';

export function safeFilePath(filePath: string): string {
  if (!/^[0-9a-f-]{36}\.pdf$/.test(filePath)) throw new ApiError(400, '文件路径无效');
  const resolved = path.resolve(uploadDir, filePath);
  if (path.dirname(resolved) !== uploadDir) throw new ApiError(400, '文件路径无效');
  return resolved;
}
export function validatePdfUpload(name: string, mime: string, size: number, header: Uint8Array) {
  if (!/\.pdf$/i.test(name)) throw new ApiError(400, '仅支持 .pdf 文件');
  if (!['application/pdf', 'application/octet-stream'].includes(mime.toLowerCase()))
    throw new ApiError(400, '文件 MIME 类型不是 PDF');
  if (!size) throw new ApiError(400, 'PDF 文件为空');
  if (size > maxUploadBytes) throw new ApiError(413, `单个 PDF 不能超过 ${maxUploadMB} MiB`);
  if (Buffer.from(header.subarray(0, 5)).toString('ascii') !== '%PDF-')
    throw new ApiError(400, '文件内容不是有效 PDF');
}
export async function importUpload(request: Request, shelfId: string | null = null) {
  if (!request.body) throw new ApiError(400, '请选择 PDF 文件');
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data'))
    throw new ApiError(415, '请使用 multipart/form-data 上传');
  if (Number(request.headers.get('content-length')) > maxUploadBytes + 1024 * 128)
    throw new ApiError(413, `单个 PDF 不能超过 ${maxUploadMB} MiB`);
  await Promise.all([mkdir(uploadDir, { recursive: true }), mkdir(tempDir, { recursive: true })]);
  const temporary = path.join(tempDir, `${randomUUID()}.part`);
  const filePath = `${randomUUID()}.pdf`;
  let originalName = '';
  let mime = '';
  let limited = false;
  let invalid = false;
  let fileCount = 0;
  let writePromise: Promise<void> | undefined;
  let moved = false;
  let committed = false;
  try {
    let parser;
    try {
      parser = busboy({
        headers: { 'content-type': contentType },
        defParamCharset: 'utf8',
        limits: { files: 1, fields: 0, fileSize: maxUploadBytes, parts: 2, headerPairs: 100 },
      });
    } catch {
      throw new ApiError(400, '上传请求格式无效');
    }
    parser.on('file', (field, stream, info) => {
      fileCount++;
      originalName = path.basename((info.filename || '').replaceAll('\\', '/')).slice(0, 240);
      mime = info.mimeType;
      if (field !== 'file') invalid = true;
      stream.on('limit', () => {
        limited = true;
      });
      writePromise = pipeline(stream, createWriteStream(temporary, { flags: 'wx' }));
      // Attach a handler immediately; pipeline completion is checked below.
      void writePromise.catch(() => undefined);
    });
    parser.on('filesLimit', () => {
      invalid = true;
    });
    parser.on('fieldsLimit', () => {
      invalid = true;
    });
    parser.on('partsLimit', () => {
      invalid = true;
    });
    try {
      await pipeline(Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>), parser);
      await writePromise;
    } catch {
      await writePromise?.catch(() => undefined);
      throw new ApiError(400, '上传中断或请求格式无效');
    }
    if (invalid || fileCount !== 1)
      throw new ApiError(400, '每次请求只能包含一个 file 字段，请逐个上传');
    if (limited) throw new ApiError(413, `单个 PDF 不能超过 ${maxUploadMB} MiB`);
    const bytes = await readFile(temporary);
    validatePdfUpload(originalName, mime, bytes.length, bytes);
    const metadata = await readMetadata(bytes, originalName);
    await rename(temporary, safeFilePath(filePath));
    moved = true;
    const paper = await db.paper.create({
      data: {
        title: metadata.title,
        pageCount: metadata.pageCount,
        fileName: originalName,
        filePath,
        fileSize: bytes.length,
        shelfId,
        report: { create: {} },
      },
      include: { report: true },
    });
    committed = true;
    return paper;
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (moved && !committed)
      await rm(safeFilePath(filePath), { force: true }).catch(() => undefined);
  }
}
export async function drainFileDeletions() {
  const entries = await db.fileDeletion.findMany();
  for (const entry of entries) {
    try {
      await rm(safeFilePath(entry.path), { force: true });
      await db.fileDeletion.deleteMany({ where: { path: entry.path } });
    } catch {
      console.error('[paperleaf] A local PDF deletion is pending; it will be retried.');
    }
  }
  return db.fileDeletion.count();
}
