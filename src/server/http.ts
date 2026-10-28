import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  // Next may normalize request.url to localhost while the browser uses 127.0.0.1.
  // Host is the actual same-origin authority; never trust X-Forwarded-Host here.
  const expected = new URL(request.url);
  const host = request.headers.get('host');
  if (host) expected.host = host;
  if (fetchSite === 'cross-site' || (origin && origin !== expected.origin)) {
    throw new ApiError(403, '拒绝跨站写入请求');
  }
}
export async function jsonBody(request: Request): Promise<unknown> {
  const limit = 1024 * 1024;
  if (Number(request.headers.get('content-length')) > limit)
    throw new ApiError(413, '请求内容过大');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '缺少请求内容');
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ApiError(413, '请求内容过大');
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new ApiError(400, 'JSON 格式无效');
    }
  } finally {
    reader.releaseLock();
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return Response.json({ error: error.issues[0]?.message || '输入无效' }, { status: 400 });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025')
      return Response.json({ error: '记录不存在或已删除' }, { status: 404 });
    if (error.code === 'P2002')
      return Response.json({ error: '该标签或记录已存在' }, { status: 409 });
    if (error.code === 'P2003')
      return Response.json({ error: '关联记录不存在，请刷新后重试' }, { status: 400 });
  }
  console.error('[paperleaf]', error instanceof Error ? error.message : 'Unknown server error');
  return Response.json({ error: '操作失败，请稍后重试；详细信息见本机服务日志' }, { status: 500 });
}
