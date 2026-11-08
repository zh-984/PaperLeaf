// Actual packaged-server regression, always with an isolated profile and local mock.
import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url);
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const JSZip = createRequire(require.resolve('mammoth/package.json'))('jszip');
const root = path.resolve('.test-data/desktop-work');
await mkdir(root, { recursive: true });
const profile = await mkdtemp(path.join(root, 'profile-'));
const manuscript = path.join(profile, 'work-demo.docx');
const zip = new JSZip();
zip.file(
  '[Content_Types].xml',
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);
zip.file(
  '_rels/.rels',
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);
zip.file(
  'word/document.xml',
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>This synthetic manuscript tests desktop persistence and text extraction.</w:t></w:r></w:p><w:p><w:r><w:t>Its sample is limited and the conclusions require independent evidence.</w:t></w:r></w:p></w:body></w:document>',
);
await writeFile(manuscript, await zip.generateAsync({ type: 'nodebuffer' }));
let requests = 0;
const mock = createServer(async (request, response) => {
  let text = '';
  for await (const chunk of request) text += chunk;
  const payload = JSON.parse(text);
  const context = JSON.parse(payload.messages.at(-1).content);
  const content = JSON.stringify({
    findings: context.paragraphs.map((p) => ({
      paragraphId: p.id,
      risk: 'medium',
      quote: p.text.slice(0, 50),
      reason: '本机模拟检查，仅验证流程',
      suggestion: '核对事实并明确研究边界',
      revision: '',
    })),
  });
  requests++;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { total_tokens: 42 },
    }),
  );
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
let desktop;
async function launch() {
  desktop = await electron.launch({
    executablePath:
      process.env.DESKTOP_EXECUTABLE || path.resolve('release/win-unpacked/Paperleaf.exe'),
    env: { ...process.env, PAPERLEAF_DESKTOP_TEST: '1', PAPERLEAF_TEST_PROFILE: profile },
    timeout: 60000,
  });
  const page = await desktop.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
  expect(await desktop.evaluate(({ app }) => app.getVersion())).toBe(version);
  return page;
}
try {
  let page = await launch();
  await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
  await page.getByRole('menuitemradio', { name: /PaperLeaf Work/ }).click();
  await page.getByLabel('上传 Work 稿件').setInputFiles(manuscript);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('work-demo');
  await page.evaluate(async (url) => {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: url,
        apiKey: 'local-work-test-only',
        model: 'synthetic-work',
      }),
    });
    if (!response.ok) throw new Error('Mock configuration failed');
  }, `http://127.0.0.1:${mock.address().port}/v1`);
  await page.reload();
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page.locator('.work-results-summary')).toContainText('检查完成', { timeout: 60000 });
  await expect(page.locator('.work-findings')).toContainText('核对事实');
  await expect(page.locator('.work-text mark').first()).toBeVisible();
  await mkdir('docs/images', { recursive: true });
  await page.screenshot({ path: 'docs/images/work-desktop.png' });
  const before = await page.evaluate(async () => {
    const [doc] = await (await fetch('/api/work')).json();
    return (await fetch('/api/work/' + doc.id)).json();
  });
  expect(requests).toBe(1);
  await desktop.close();
  desktop = undefined;
  page = await launch();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('work-demo');
  await expect(page.locator('.work-results-summary')).toContainText('检查完成');
  const after = await page.evaluate(
    async (id) => (await fetch('/api/work/' + id)).json(),
    before.id,
  );
  expect(after.paragraphs).toEqual(before.paragraphs);
  expect(after.tasks[0]).toEqual(before.tasks[0]);
  expect(requests).toBe(1);
  const layout = await page.evaluate(() => ({
    height: innerHeight,
    body: document.documentElement.scrollHeight,
    bottom: document.querySelector('.work-shelf').getBoundingClientRect().bottom,
  }));
  expect(layout.body).toBeLessThanOrEqual(layout.height + 1);
  expect(layout.bottom).toBeCloseTo(layout.height, 0);
  await page.getByRole('tab', { name: '公开来源查重' }).click();
  await page.getByLabel('检索开放论文').uncheck();
  await page.getByRole('button', { name: '开始查重', exact: true }).click();
  await expect(page.locator('.work-results-summary')).toContainText('没有取得来源');
  await page.getByRole('button', { name: '删除 Work 稿件', exact: true }).click();
  await page.getByRole('button', { name: '确认删除稿件' }).click();
  await expect(page.getByRole('heading', { name: 'work-demo', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
  await page.getByRole('menuitemradio', { name: /PaperLeaf Read/ }).click();
  await expect(page.getByText('放入你的第一篇文献')).toBeVisible();
  console.log(
    JSON.stringify({
      packagedWork: true,
      version,
      realDocxExtracted: true,
      analysisSaved: true,
      fullRestartPreserved: true,
      repeatAiCalls: 0,
      publicNoSourceNotCalculated: true,
      cascadeDelete: true,
      readModeAvailable: true,
      paidAiRequests: 0,
    }),
  );
} catch (error) {
  console.error(
    await readFile(path.join(profile, 'logs/desktop.log'), 'utf8').catch(() => 'No startup log'),
  );
  throw error;
} finally {
  if (desktop) await desktop.close();
  mock.closeAllConnections();
  await new Promise((resolve) => mock.close(resolve));
}
