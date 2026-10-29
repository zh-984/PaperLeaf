import { after } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  idSchema,
  notePatchSchema,
  noteSchema,
  paperPatchSchema,
  referenceSaveSchema,
  citationSettingsSchema,
} from '@/lib/validation';
import { parseByteRange } from '@/lib/range';
import { db } from '@/server/db';
import { ApiError, assertSameOrigin, errorResponse, jsonBody } from '@/server/http';
import { paperDto, requirePaper } from '@/server/papers';
import { drainFileDeletions, importUpload, safeFilePath } from '@/server/storage';
import { maxUploadFiles, maxUploadMB } from '@/server/config';
import { getAiConfig, saveAiConfig, aiSettingsSchema } from '@/server/ai/settings';
import { repairPaperTitle } from '@/server/repair-titles';
import { anchoredDto } from '@/server/anchor-dto';
import { supportsVisionModel } from '@/lib/ai-models';
import { cancelReport, recoverInterrupted, startReport } from '@/server/ai/report';
import { bookshelfSchema, bookshelfPatchSchema, preferencesSchema } from '@/lib/validation';
import { getPreferences } from '@/server/preferences';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, context: Context): Promise<Response> {
  try {
    const { path } = await context.params;
    const [resource, id, child, childId] = path;
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(request);
    if (path.length > 4) throw new ApiError(404, '接口不存在');
    if (resource === 'preferences' && path.length === 1) {
      if (method === 'GET') return Response.json(await getPreferences());
      if (method === 'PATCH') {
        const data = preferencesSchema.parse(await jsonBody(request));
        return Response.json(
          await db.appPreference.upsert({
            where: { id: 'local' },
            create: { id: 'local', ...data },
            update: data,
          }),
        );
      }
    }
    if (resource === 'citation-settings' && path.length === 1) {
      if (method === 'GET') {
        const settings = await db.citationSettings.findUnique({ where: { id: 'local' } });
        return Response.json(
          settings || {
            markerTemplate: '[{{number}}]',
            referenceTemplate:
              '[{{number}}] {{authors}}. {{title}}[{{type}}]. {{journal}}, {{year}}, {{volume}}({{issue}}): {{pages}}. {{doi}}',
          },
        );
      }
      if (method === 'PATCH') {
        const data = citationSettingsSchema.parse(await jsonBody(request));
        return Response.json(
          await db.citationSettings.upsert({
            where: { id: 'local' },
            create: { id: 'local', ...data },
            update: data,
          }),
        );
      }
    }
    if (resource === 'bookshelves' && path.length <= 2) {
      if (!id && method === 'GET')
        return Response.json(await db.bookshelf.findMany({ orderBy: { createdAt: 'asc' } }));
      if (!id && method === 'POST')
        return Response.json(
          await db.bookshelf.create({ data: bookshelfSchema.parse(await jsonBody(request)) }),
          { status: 201 },
        );
      idSchema.parse(id);
      if (method === 'PATCH')
        return Response.json(
          await db.bookshelf.update({
            where: { id },
            data: bookshelfPatchSchema.parse(await jsonBody(request)),
          }),
        );
      if (method === 'DELETE') {
        await db.$transaction([
          db.paper.updateMany({ where: { shelfId: id }, data: { shelfId: null } }),
          db.bookshelf.delete({ where: { id } }),
        ]);
        return Response.json({ deleted: true });
      }
    }
    if (resource === 'settings' && path.length === 1 && ['GET', 'POST'].includes(method)) {
      if (method === 'POST') saveAiConfig(aiSettingsSchema.parse(await jsonBody(request)));
      const config = getAiConfig();
      let aiHost = '';
      try {
        aiHost = new URL(config.baseUrl).host;
      } catch {
        /* Invalid configuration is reported at invocation. */
      }
      return Response.json({
        aiEnabled: config.enabled,
        aiModel: config.model,
        aiBaseUrl: config.baseUrl,
        aiHasKey: Boolean(config.apiKey),
        aiVisionEnabled: supportsVisionModel(config.model),
        aiProfiles: [1, 2, 3].map((slot) => {
          const item = getAiConfig(slot);
          let host = '';
          try {
            host = new URL(item.baseUrl).host;
          } catch {
            /* Invalid configuration is reported when used. */
          }
          return {
            slot,
            model: item.model,
            baseUrl: item.baseUrl,
            host,
            enabled: item.enabled,
            hasKey: Boolean(item.apiKey),
          };
        }),
        aiHost,
        maxUploadFiles,
        maxUploadMB,
        desktopMode: process.env.PAPERLEAF_DESKTOP === '1',
      });
    }
    if (resource !== 'papers') throw new ApiError(404, '接口不存在');
    if (!id && method === 'GET') {
      await drainFileDeletions();
      const running = await db.insightReport.findMany({
        where: { status: 'running' },
        select: { paperId: true },
      });
      for (const report of running) await recoverInterrupted(report.paperId);
      const papers = await db.paper.findMany({
        orderBy: { createdAt: 'desc' },
        include: { report: true },
      });
      return Response.json((await Promise.all(papers.map(repairPaperTitle))).map(paperDto));
    }
    if (!id && method === 'POST') {
      const shelfQuery = new URL(request.url).searchParams.get('shelfId');
      const shelfId = shelfQuery === null ? null : idSchema.parse(shelfQuery);
      if (shelfId) {
        idSchema.parse(shelfId);
        if (!(await db.bookshelf.findUnique({ where: { id: shelfId } })))
          throw new ApiError(404, '目标书架不存在');
      }
      const preferences = await getPreferences();
      const paper = await importUpload(request, shelfId);
      if (getAiConfig().enabled && preferences.autoInterpret) {
        const job = startReport(paper.id);
        after(() => job);
        if (paper.report) paper.report.status = 'running';
      }
      return Response.json(paperDto(paper), { status: 201 });
    }
    idSchema.parse(id);
    const paper = await requirePaper(id);
    if (child === 'reference' && !childId) {
      if (method === 'GET') {
        const record = await db.reference.findUnique({ where: { paperId: id } });
        return Response.json(
          record || {
            type: 'journal',
            title: paper.title,
            authors: '',
            year: '',
            journal: '',
            volume: '',
            issue: '',
            pages: '',
            doi: '',
            publisher: '',
          },
        );
      }
      if (method === 'PATCH') {
        const { reference, settings } = referenceSaveSchema.parse(await jsonBody(request));
        const [saved] = await db.$transaction([
          db.reference.upsert({
            where: { paperId: id },
            create: { paperId: id, ...reference },
            update: reference,
          }),
          db.citationSettings.upsert({
            where: { id: 'local' },
            create: { id: 'local', ...settings },
            update: settings,
          }),
        ]);
        return Response.json(saved);
      }
    }
    if (!child && method === 'GET') {
      await recoverInterrupted(id);
      const [fresh, notes, history] = await Promise.all([
        requirePaper(id),
        db.note.findMany({ where: { paperId: id }, orderBy: { createdAt: 'desc' } }),
        db.aiHistory.findMany({ where: { paperId: id }, orderBy: { createdAt: 'asc' } }),
      ]);
      return Response.json({
        ...paperDto(fresh),
        notes: notes.map(anchoredDto),
        history: history.map(anchoredDto),
      });
    }
    if (!child && method === 'PATCH') {
      const data = paperPatchSchema.parse(await jsonBody(request));
      if (data.lastPage && data.lastPage > paper.pageCount)
        throw new ApiError(400, '页码超出文献范围');
      if (data.shelfId && !(await db.bookshelf.findUnique({ where: { id: data.shelfId } })))
        throw new ApiError(404, '目标书架不存在');
      return Response.json(
        paperDto(await db.paper.update({ where: { id }, data, include: { report: true } })),
      );
    }
    if (!child && method === 'DELETE') {
      await cancelReport(id);
      await db.$transaction([
        db.fileDeletion.upsert({
          where: { path: paper.filePath },
          create: { path: paper.filePath },
          update: {},
        }),
        db.paper.delete({ where: { id } }),
      ]);
      await drainFileDeletions();
      const pending = Boolean(
        await db.fileDeletion.findUnique({ where: { path: paper.filePath } }),
      );
      return Response.json(
        { deleted: true, pendingFileDeletion: pending },
        { status: pending ? 202 : 200 },
      );
    }
    if (child === 'file' && !childId && (method === 'GET' || method === 'HEAD')) {
      const filePath = safeFilePath(paper.filePath);
      const file = await stat(filePath).catch(() => {
        throw new ApiError(404, '本地 PDF 文件缺失，请重新导入');
      });
      const headers = new Headers({
        'Content-Type': 'application/pdf',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename="paper.pdf"; filename*=UTF-8''${encodeURIComponent(paper.fileName)}`,
      });
      const rangeHeader = request.headers.get('range');
      const range = rangeHeader
        ? parseByteRange(rangeHeader, file.size)
        : { start: 0, end: file.size - 1 };
      if (!range)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${file.size}` },
        });
      headers.set('Content-Length', String(range.end - range.start + 1));
      if (rangeHeader)
        headers.set('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
      const stream =
        method === 'HEAD'
          ? null
          : (Readable.toWeb(createReadStream(filePath, range)) as ReadableStream<Uint8Array>);
      return new Response(stream, { status: rangeHeader ? 206 : 200, headers });
    }
    if (child === 'notes') {
      if (!childId && method === 'POST') {
        const { anchor, ...data } = noteSchema.parse(await jsonBody(request));
        if (data.page && data.page > paper.pageCount) throw new ApiError(400, '页码超出文献范围');
        if (anchor?.locations.some((location) => location.page > paper.pageCount))
          throw new ApiError(400, '笔记选区超出文献范围');
        return Response.json(
          anchoredDto(
            await db.note.create({
              data: { paperId: id, ...data, anchorJson: anchor ? JSON.stringify(anchor) : '' },
            }),
          ),
          {
            status: 201,
          },
        );
      }
      idSchema.parse(childId);
      const note = await db.note.findFirst({ where: { id: childId, paperId: id } });
      if (!note) throw new ApiError(404, '笔记不存在');
      if (method === 'PATCH') {
        const { version, anchor, ...data } = notePatchSchema.parse(await jsonBody(request));
        if (data.page && data.page > paper.pageCount) throw new ApiError(400, '页码超出文献范围');
        if (anchor?.locations.some((location) => location.page > paper.pageCount))
          throw new ApiError(400, '笔记选区超出文献范围');
        const result = await db.note.updateMany({
          where: { id: childId, paperId: id, version },
          data: {
            ...data,
            ...(anchor !== undefined ? { anchorJson: anchor ? JSON.stringify(anchor) : '' } : {}),
            version: { increment: 1 },
          },
        });
        if (!result.count)
          throw new ApiError(409, '笔记已在其他窗口更新。本机草稿已保留，请刷新对照后重试');
        return Response.json(
          anchoredDto(await db.note.findUniqueOrThrow({ where: { id: childId } })),
        );
      }
      if (method === 'DELETE') {
        await db.note.delete({ where: { id: childId } });
        return Response.json({ deleted: true });
      }
    }
    throw new ApiError(404, '接口不存在或请求方法不支持');
  } catch (error) {
    return errorResponse(error);
  }
}
export { handler as GET, handler as HEAD, handler as POST, handler as PATCH, handler as DELETE };
