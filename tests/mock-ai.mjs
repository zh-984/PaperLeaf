// Test-only, loopback-only OpenAI-compatible simulator. Never imported by the app.
import http from 'node:http';
import { createHash } from 'node:crypto';
let calls = [];
let failSummaryAt = 0;
let summaryCount = 0;
let delay = 350;
let failVisualAt = 0;
let visualCount = 0;
let pointCounts = {};
const server = http.createServer(async (request, response) => {
  const send = (status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (request.url === '/stats') {
    send(200, { calls });
    return;
  }
  let raw = '';
  for await (const part of request) raw += part;
  if (request.url === '/control') {
    const input = JSON.parse(raw || '{}');
    calls = [];
    summaryCount = 0;
    failSummaryAt = input.failSummaryAt || 0;
    delay = input.delay ?? 350;
    failVisualAt = input.failVisualAt || 0;
    visualCount = 0;
    pointCounts = input.pointCounts || {};
    send(200, { ok: true });
    return;
  }
  if (request.url !== '/v1/chat/completions') {
    send(404, {});
    return;
  }
  const body = JSON.parse(raw);
  const system = body.messages[0].content;
  const task = system.includes('VISUAL_SUMMARY')
    ? 'visual-summary'
    : system.includes('CHUNK_SUMMARY')
      ? 'chunk-summary'
      : system.match(/REPORT_SECTION (\w+)/)?.[1] || 'ask';
  const input = body.messages
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n'),
    )
    .join('\n');
  const images = body.messages.reduce(
    (sum, message) =>
      sum +
      (Array.isArray(message.content)
        ? message.content.filter((part) => part.type === 'image_url').length
        : 0),
    0,
  );
  const hash = createHash('sha256').update(input).digest('hex');
  const call = {
    task,
    hash,
    inputLength: input.length,
    images,
    failed: false,
    generalKnowledgeAllowed: system.includes('一般知识') && system.includes('不要编造文献依据'),
    model: body.model,
    hasLinkedSource: input.includes('关联文献：《Linked Reference》'),
  };
  calls.push(call);
  if (task === 'visual-summary') {
    visualCount++;
    if (failVisualAt && visualCount === failVisualAt) {
      call.failed = true;
      failVisualAt = 0;
      send(429, { error: { message: 'Test visual failure' } });
      return;
    }
  }
  if (task === 'chunk-summary') {
    summaryCount++;
    if (failSummaryAt && summaryCount === failSummaryAt) {
      call.failed = true;
      failSummaryAt = 0;
      send(429, { error: { message: 'Test failure' } });
      return;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, delay));
  let content;
  if (task === 'chunk-summary' || task === 'visual-summary')
    content =
      '[p.2] Methods: The method uses a controlled experiment. 研究比较结构化阅读。样本较小，外部效度不确定。保留研究问题、方法、结论和局限。';
  else if (task === 'ask' && input.includes('特朗普是谁'))
    content = '原文未提到特朗普。一般知识：唐纳德·特朗普是一名美国政治人物和商人。（本地模拟回答）';
  else if (task === 'ask')
    content =
      '一句话结论：这段原文说明作者采用了对照实验。\n\n- 原文关键片段：“The method uses a controlled experiment.”（p.2）\n- 通俗地说，比较不同条件下的表现。\n- 不确定：当前页没有说明样本是否足以推广。\n\n（本地自动化测试模拟回答）';
  else {
    const count = pointCounts[task] ?? (task === 'terms' ? 5 : task === 'questions' ? 3 : 2);
    content = JSON.stringify({
      conclusion: `模拟解读：${task} 板块先说明研究结论，细节请回到原文核对。`,
      points: Array.from({ length: count }, (_, index) => ({
        text: `${task === 'terms' ? '对照实验：比较不同条件的方法' : task === 'questions' ? '样本变化后是否仍然成立？' : '这项研究通过对照实验探讨结构化阅读'} · 要点 ${index + 1}`,
        page: 2,
        quote: 'The method uses a controlled experiment.',
      })),
    });
  }
  send(200, {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { total_tokens: 123 },
  });
});
server.listen(4123, '127.0.0.1', () => console.log('Test AI simulator: http://127.0.0.1:4123'));
