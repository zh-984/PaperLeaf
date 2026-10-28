import { after } from 'next/server';
import { idSchema, reportInputSchema } from '@/lib/validation';
import { errorResponse, assertSameOrigin, jsonBody } from '@/server/http';
import { requireAi } from '@/server/ai/client';
import { recoverInterrupted, startReport } from '@/server/ai/report';
import { requirePaper, reportDto } from '@/server/papers';
import type { ReportEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    requireAi();
    const { id } = await context.params;
    idSchema.parse(id);
    await requirePaper(id);
    const { force } = reportInputSchema.parse(await jsonBody(request));
    const job = startReport(id, force);
    after(() => job);
    return Response.json({ started: true }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    idSchema.parse(id);
    await requirePaper(id);
    await recoverInterrupted(id);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let previous = '';
        const send = (event: ReportEvent) => {
          if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          while (!cancelled && !request.signal.aborted) {
            const paper = await requirePaper(id);
            if (!paper.report) break;
            const report = reportDto(paper.report);
            const serialized = JSON.stringify(report);
            if (serialized !== previous) {
              send({ type: 'snapshot', report });
              previous = serialized;
            }
            if (report.status !== 'running') {
              send({ type: 'done' });
              break;
            }
            // Heartbeats keep slow providers visibly connected while a section is pending.
            if (!cancelled) controller.enqueue(encoder.encode(': heartbeat\n\n'));
            await new Promise<void>((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, 500);
            });
          }
        } catch {
          send({ type: 'error', message: '报告连接中断，请刷新重连；服务端已完成的内容会保留' });
        } finally {
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
        clearTimeout(timer);
        wake?.();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
