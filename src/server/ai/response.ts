import { z } from 'zod';
import { ApiError } from '../http';

const envelope = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.unknown().optional(),
          reasoning_content: z.string().nullish(),
          refusal: z.string().nullish(),
        }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: z.object({ total_tokens: z.number().nonnegative().optional() }).optional(),
});
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => {
      if (!part || typeof part !== 'object' || !('text' in part)) return '';
      if ('type' in part && part.type !== 'text' && part.type !== 'output_text') return '';
      return typeof part.text === 'string' ? part.text : '';
    })
    .join('\n');
}
export function parseCompletion(payload: unknown) {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success)
    throw new ApiError(
      502,
      'AI 服务未返回兼容的 choices/message 数据；请检查服务是否支持 Chat Completions',
    );
  const choice = parsed.data.choices[0],
    text = contentText(choice.message.content).trim();
  if (choice.finish_reason === 'length')
    throw new ApiError(
      502,
      '模型的思考或回答达到输出上限，未生成完整答案；已保留进度，不会自动重复扣费。可点击继续解读。',
    );
  if (choice.finish_reason === 'content_filter' || choice.message.refusal)
    throw new ApiError(502, 'AI 服务拒绝了这次请求或触发内容过滤；已完成的分段仍保留');
  if (!text)
    throw new ApiError(
      502,
      choice.message.reasoning_content
        ? '模型只返回了思考内容，没有最终回答；已保留进度。请检查该服务的推理预算，或点击继续解读。'
        : 'AI 服务返回了空回答；已保留进度，可点击继续解读。',
    );
  return { text, tokens: parsed.data.usage?.total_tokens ?? 0 };
}
export async function readCompletion(response: Response) {
  const raw = await response.text();
  if (raw.length > 4 * 1024 * 1024) throw new ApiError(502, 'AI 返回内容过长，已停止读取');
  if (
    response.headers.get('content-type')?.includes('text/event-stream') ||
    raw.trimStart().startsWith('data:')
  ) {
    let content = '',
      reasoning = '',
      finish: string | null = null,
      tokens = 0;
    for (const event of raw.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        const part = z
          .object({
            choices: z
              .array(
                z.object({
                  delta: z
                    .object({
                      content: z.unknown().optional(),
                      reasoning_content: z.string().nullish(),
                    })
                    .optional(),
                  finish_reason: z.string().nullish(),
                }),
              )
              .optional(),
            usage: z.object({ total_tokens: z.number().optional() }).optional(),
          })
          .parse(JSON.parse(data));
        const choice = part.choices?.[0];
        content += contentText(choice?.delta?.content);
        reasoning += choice?.delta?.reasoning_content || '';
        finish = choice?.finish_reason || finish;
        tokens = part.usage?.total_tokens ?? tokens;
      } catch {
        throw new ApiError(502, 'AI 流式数据损坏，请检查兼容服务');
      }
    }
    return parseCompletion({
      choices: [{ message: { content, reasoning_content: reasoning }, finish_reason: finish }],
      usage: { total_tokens: tokens },
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ApiError(502, 'AI 服务返回的不是 JSON 或 SSE 数据，请检查 API 地址');
  }
  return parseCompletion(value);
}
