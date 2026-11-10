import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { ApiError, assertSameOrigin, errorResponse, jsonBody } from '@/server/http';
import { idSchema } from '@/lib/validation';
import { drainWorkFiles, importWork, requireWork } from '@/server/work/documents';
import { beginWork, cancelWork, recoverWork, workTaskInput } from '@/server/work/tasks';
import { addSource, discoverSources } from '@/server/work/sources';
import { detectorDto, detectorSettingsSchema, saveWorkDetector } from '@/server/work/detector';
import { localDetectorState, startLocalInstall } from '@/server/work/local-detector';
import { sourceError } from '@/server/work/discovery';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path?: string[] }> };
export async function workHandler(request: Request, context: Context): Promise<Response> {
  try {
    const [id, action, child] = (await context.params).path || [];
    const method = request.method;
    if (method !== 'GET') assertSameOrigin(request);
    if (!id) {
      if (method === 'GET') {
        await drainWorkFiles().catch(() => undefined);
        return Response.json(
          await db.workDocument.findMany({
            select: {
              id: true,
              title: true,
              fileName: true,
              fileSize: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { createdAt: 'desc' },
          }),
        );
      }
      if (method === 'POST') return Response.json(await importWork(request), { status: 201 });
    }
    if (id === 'capabilities' && method === 'GET')
      return Response.json({
        ...detectorDto(),
        local: localDetectorState(),
        sources: 'Europe PMC / OpenAlex / arXiv + 用户补充公开链接',
      });
    if (id === 'local-detector') {
      if (method === 'GET') return Response.json(localDetectorState());
      if (method === 'POST') {
        const { force } = z
          .object({ force: z.boolean().default(false) })
          .strict()
          .parse(await jsonBody(request));
        const install = startLocalInstall(force);
        after(install.run);
        return Response.json(install.state, { status: 202 });
      }
    }
    if (id === 'state') {
      if (method === 'GET')
        return Response.json(
          (await db.workPreference.findUnique({ where: { id: 'local' } })) || {
            mode: 'read',
            documentId: '',
          },
        );
      if (method === 'PATCH') {
        const input = z
          .object({
            mode: z.enum(['read', 'work']).optional(),
            documentId: z.union([idSchema, z.literal('')]).optional(),
          })
          .strict()
          .parse(await jsonBody(request));
        if (input.documentId) await requireWork(input.documentId);
        return Response.json(
          await db.workPreference.upsert({
            where: { id: 'local' },
            create: { id: 'local', ...input },
            update: input,
          }),
        );
      }
    }
    if (id === 'detector-settings' && method === 'PATCH')
      return Response.json(saveWorkDetector(detectorSettingsSchema.parse(await jsonBody(request))));
    idSchema.parse(id);
    await requireWork(id!);
    if (!action) {
      if (method === 'GET') {
        await recoverWork(id);
        const doc = await db.workDocument.findUniqueOrThrow({
          where: { id },
          include: { tasks: { orderBy: { createdAt: 'desc' }, take: 20 }, sources: true },
        });
        const { paragraphsJson, tasks, sources, filePath, hash, ...rest } = doc;
        void filePath;
        void hash;
        return Response.json({
          ...rest,
          paragraphs: JSON.parse(paragraphsJson),
          tasks: tasks.map((task) => ({
            id: task.id,
            kind: task.kind,
            status: task.status,
            progress: task.progress,
            error: task.error,
            results: JSON.parse(task.resultsJson),
            createdAt: task.createdAt,
          })),
          sources: sources.map((source) => ({
            id: source.id,
            title: source.title,
            url: source.url,
            characters: source.text.length,
          })),
        });
      }
      if (method === 'PATCH')
        return Response.json(
          await db.workDocument.update({
            where: { id },
            data: z
              .object({ title: z.string().trim().min(1).max(300) })
              .parse(await jsonBody(request)),
          }),
        );
      if (method === 'DELETE') {
        const doc = await requireWork(id!);
        const tasks = await db.workTask.findMany({ where: { documentId: id, status: 'running' } });
        for (const task of tasks) cancelWork(task.id);
        await db.$transaction([
          db.fileDeletion.create({ data: { path: `work/${doc.filePath}` } }),
          db.workDocument.delete({ where: { id } }),
        ]);
        await drainWorkFiles().catch(() => undefined);
        return Response.json({ ok: true });
      }
    }
    if (action === 'tasks') {
      if (method === 'POST' && !child) {
        const job = await beginWork(id!, workTaskInput.parse(await jsonBody(request)));
        after(job.run);
        return Response.json({ id: job.task.id }, { status: 202 });
      }
      if (method === 'DELETE' && child) {
        idSchema.parse(child);
        const task = await db.workTask.findFirst({ where: { id: child, documentId: id } });
        if (!task) throw new ApiError(404, '任务不存在');
        cancelWork(child);
        await db.workTask.updateMany({
          where: { id: child, status: 'running' },
          data: { status: 'cancelled', progress: '已取消' },
        });
        return Response.json({ ok: true });
      }
    }
    if (action === 'sources') {
      if (await db.workTask.count({ where: { documentId: id, status: 'running' } }))
        throw new ApiError(409, '检查进行中，请先取消再修改来源');
      if (method === 'POST' && !child) {
        const data = z.object({ url: z.url().max(2000) }).parse(await jsonBody(request));
        const source = await addSource(id!, data.url, request.signal).catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(422, `读取来源失败：${sourceError(error)}`);
        });
        return Response.json(
          { id: source.id, title: source.title, url: source.url, characters: source.text.length },
          { status: 201 },
        );
      }
      if (method === 'DELETE' && child) {
        idSchema.parse(child);
        await db.workSource.deleteMany({ where: { id: child, documentId: id } });
        return Response.json({ ok: true });
      }
    }
    if (action === 'discover' && method === 'POST') {
      const data = z
        .object({ query: z.string().trim().min(2).max(250) })
        .parse(await jsonBody(request));
      return Response.json(await discoverSources(data.query, request.signal));
    }
    throw new ApiError(404, 'Work 接口不存在');
  } catch (error) {
    return errorResponse(error);
  }
}
export const GET = workHandler,
  POST = workHandler,
  PATCH = workHandler,
  DELETE = workHandler;
