import { z } from 'zod';
import { askSchema } from '@/lib/validation';
import { getPages, requirePaper } from '../papers';
import { completion, requireAi, type Message } from './client';
import { db } from '../db';
import { ApiError } from '../http';
import { aiMaxInput } from '../config';
import { anchoredDto } from '../anchor-dto';
import { supportsVisionModel } from '@/lib/ai-models';
import { renderPageImages } from '../pdf';
import { readFile } from 'node:fs/promises';
import { safeFilePath } from '../storage';
import { getAiConfig } from './settings';

export async function askPaper(id: string, input: z.infer<typeof askSchema>, signal: AbortSignal) {
  requireAi();
  const paper = await requirePaper(id);
  if (input.page > paper.pageCount) throw new ApiError(400, '页码超出文献范围');
  if (input.anchor?.locations.some((location) => location.page > paper.pageCount))
    throw new ApiError(400, '选区超出文献范围');
  const config = getAiConfig(),
    vision = supportsVisionModel(config.model);
  const pages = await getPages(id, vision);
  const currentPage = pages.find((page) => page.page === input.page)?.text || '';
  const history = await db.aiHistory.findMany({
    where: { paperId: id, page: input.page },
    orderBy: { createdAt: 'desc' },
    take: 4,
  });
  const actions = {
    translate: '将选中文字翻译成中文，保留原文关键术语。',
    explain: '用通俗语言解释选中文字。',
    term: '解释选中文字中的关键术语，并说明在当前文献里的含义。',
    question: input.question,
  };
  const messages: Message[] = [
    {
      role: 'system',
      content:
        '你是文献阅读助手，也可以回答用户的一般问题。先回答用户真正的问题，再视需要关联当前文献；如果问题与文献无关，不必强行引用原文。请区分原文内容与一般知识：原文未提到的信息可以依据已有知识回答，并说明不是来自原文；不要编造文献依据或页码。讨论文献时，优先引用或复述可核实的当前页内容并标注页码；其他页无依据时说明不确定。无法确定或可能已经变化的事实应如实说明，不能假装掌握实时信息。回答先给一句话结论，再按需要列要点。',
    },
    {
      role: 'user',
      content: `文献：${paper.title}\n[p.${input.page}] 当前页上下文：\n${currentPage.slice(0, 4500)}`,
    },
  ];
  for (const item of history.reverse()) {
    messages.push({
      role: 'user',
      content: `${(item.question || item.action).slice(0, 400)}\n选中：${item.selectedText.slice(0, 300)}`,
    });
    messages.push({ role: 'assistant', content: item.answer.slice(0, 700) });
  }
  messages.push({
    role: 'user',
    content: `选中文字：${input.selectedText.slice(0, 3000) || '（未选择，以当前页为依据）'}\n请求：${actions[input.action]}`,
  });
  // Trim oldest conversation pairs, then context, while retaining the latest question.
  const budget = Math.max(4000, aiMaxInput);
  const length = () =>
    messages.reduce(
      (sum, item) => sum + (typeof item.content === 'string' ? item.content.length : 0),
      0,
    );
  while (messages.length > 3 && length() > budget) messages.splice(2, 2);
  if (length() > budget)
    messages[1].content = (messages[1].content as string).slice(
      0,
      Math.max(0, (messages[1].content as string).length - (length() - budget)),
    );
  if (length() > budget)
    messages[messages.length - 1].content = (messages[messages.length - 1].content as string).slice(
      -(budget - (messages[0].content as string).length),
    );
  if (vision) {
    const [image] = await renderPageImages(await readFile(safeFilePath(paper.filePath)), [
      input.page,
    ]);
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `[p.${input.page}] 当前页图像。问题涉及文献时可用来核对；一般问题可直接回答。读不清的内容不要猜测。`,
        },
        { type: 'image_url', image_url: { url: image.url } },
      ],
    });
  }
  const result = await completion(messages, signal, undefined, config);
  const { anchor, ...data } = input;
  return anchoredDto(
    await db.aiHistory.create({
      data: {
        paperId: id,
        ...data,
        answer: result.text,
        anchorJson: anchor ? JSON.stringify(anchor) : '',
      },
    }),
  );
}
