// Run after pnpm build and pnpm test:e2e. Uses only isolated e2e data.
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
const base = 'http://127.0.0.1:3201';
async function boot() {
  const child = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3201'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        NEXT_DIST_DIR: '.next',
        NEXT_TELEMETRY_DISABLED: '1',
        DATA_DIR: path.resolve('.test-data/e2e-ai'),
        DATABASE_URL: `file:${path.resolve('.test-data/e2e-ai/library.db').replaceAll('\\', '/')}`,
        AI_ENABLED: 'false',
        OPENAI_API_KEY: '',
      },
    },
  );
  let logs = '';
  child.stdout.on('data', (data) => {
    logs += data;
  });
  child.stderr.on('data', (data) => {
    logs += data;
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try {
      if ((await fetch(`${base}/api/settings`)).ok) return child;
    } catch {
      /* Poll until ready. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stop(child);
  throw new Error(`Server did not become ready: ${logs}`);
}
async function stop(child) {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32')
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  else child.kill('SIGTERM');
  await exited;
}
async function snapshot() {
  const papers = await (await fetch(`${base}/api/papers`)).json();
  assert.ok(papers.length >= 1, 'Run e2e tests first to populate isolated data');
  const result = [];
  for (const paper of papers) {
    const detail = await (await fetch(`${base}/api/papers/${paper.id}`)).json();
    assert.equal(detail.report.status, 'complete');
    assert.equal(detail.report.sections.length, 10);
    const file = await fetch(`${base}/api/papers/${paper.id}/file`, {
      headers: { Range: 'bytes=0-4' },
    });
    assert.equal(file.status, 206);
    assert.equal(await file.text(), '%PDF-');
    result.push({
      id: detail.id,
      title: detail.title,
      lastPage: detail.lastPage,
      report: detail.report,
      notes: detail.notes,
      history: detail.history,
    });
  }
  return result;
}
let server;
try {
  server = await boot();
  const before = await snapshot();
  await stop(server);
  server = undefined;
  server = await boot();
  const after = await snapshot();
  assert.deepEqual(after, before);
  assert.ok(
    after.some((paper) => paper.notes.length > 0),
    'Saved AI note must survive restart',
  );
  console.log(
    `PASS: ${after.length} papers, cached 10-section reports, PDF files, page positions, notes and AI history survived a full production server restart.`,
  );
} finally {
  if (server) await stop(server);
}
