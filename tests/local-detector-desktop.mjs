// Real packaged ONNX + tokenizer integration. Uses only a synthetic document.
import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url),
  JSZip = createRequire(require.resolve('mammoth/package.json'))('jszip');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir('.test-data/local-desktop', { recursive: true });
const profile = await mkdtemp(path.resolve('.test-data/local-desktop/profile-'));
const text =
  '本段为知页软件的本地功能测试材料，并非真实发表的学术论文。我们在测试中检查模型是否能够读取中文段落，处理超过长度限制的文本，并将检查结果保存在本机。检测模型只能根据写作模式给出参考分数，不能证明作者身份；实际研究结论必须结合原始数据、引用以及实验记录核实。';
const zip = new JSZip();
zip.file(
  '[Content_Types].xml',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);
zip.file(
  '_rels/.rels',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);
zip.file(
  'word/document.xml',
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文本地推理测试</w:t></w:r></w:p><w:p><w:r><w:t>${text.repeat(5)}</w:t></w:r></w:p></w:body></w:document>`,
);
const manuscript = path.join(profile, 'local-demo.docx');
await writeFile(manuscript, await zip.generateAsync({ type: 'nodebuffer' }));
const app = await electron.launch({
  executablePath:
    process.env.DESKTOP_EXECUTABLE || path.resolve('release/win-unpacked/Paperleaf.exe'),
  env: {
    ...process.env,
    PAPERLEAF_DESKTOP_TEST: '1',
    PAPERLEAF_TEST_PROFILE: profile,
    WORK_LOCAL_MODEL_DIR:
      process.env.WORK_LOCAL_MODEL_DIR || path.resolve('data/models/aigc-zh-v3'),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
  expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version);
  await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
  await page.getByRole('menuitemradio', { name: /PaperLeaf Work/ }).click();
  await page.getByLabel('上传 Work 稿件').setInputFiles(manuscript);
  await expect(page.getByRole('heading', { level: 1, name: 'local-demo' })).toBeVisible();
  await expect(page.locator('.work-options > summary')).toContainText('本地运行');
  await expect(page.getByLabel('检测方式')).toHaveValue('local');
  const started = Date.now();
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page.locator('.work-results-summary')).toContainText('检查完成', { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const [doc] = await (await fetch('/api/work')).json();
    return (await fetch('/api/work/' + doc.id)).json();
  });
  expect(result.tasks[0].results.engine).toBe('local');
  expect(result.tasks[0].results.findings.some((f) => typeof f.score === 'number')).toBe(true);
  expect(result.tasks[0].results.findings.find((f) => f.paragraphId === 'p1').risk).toBe('unknown');
  expect(
    await page.evaluate(async () => (await (await fetch('/api/settings')).json()).aiEnabled),
  ).toBe(false);
  await mkdir('docs/images', { recursive: true });
  await page.screenshot({ path: 'docs/images/work-local-detection.png' });
  console.log(
    JSON.stringify({
      packagedLocalDetector: true,
      version,
      offlineCPUModel: true,
      noAIKey: true,
      longChineseParagraph: true,
      shortTextAbstained: true,
      milliseconds: Date.now() - started,
      accuracyNotEvaluated: true,
    }),
  );
} finally {
  await app.close();
}
