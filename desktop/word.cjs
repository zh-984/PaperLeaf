const path = require('node:path');
const { spawn } = require('node:child_process');
let busy = false;
function runWord(input, script, testMode = false) {
  if (busy) return Promise.reject(new Error('Word 正在更新，请稍候'));
  if (!input || !['insert', 'update'].includes(input.action))
    return Promise.reject(new Error('无效的 Word 操作'));
  const data = JSON.stringify(input);
  if (
    data.length > 20000 ||
    !input.settings ||
    !input.settings.markerTemplate?.includes('{{number}}') ||
    !input.settings.referenceTemplate?.includes('{{title}}')
  )
    return Promise.reject(new Error('引用格式无效'));
  if (
    (input.settings.markerSuperscript !== undefined &&
      typeof input.settings.markerSuperscript !== 'boolean') ||
    (input.settings.bibliographyIndent !== undefined &&
      !['none', 'firstLine', 'hanging'].includes(input.settings.bibliographyIndent)) ||
    (input.settings.indentCharacters !== undefined &&
      (!Number.isFinite(input.settings.indentCharacters) ||
        input.settings.indentCharacters < 0 ||
        input.settings.indentCharacters > 10))
  )
    return Promise.reject(new Error('引用显示或缩进设置无效'));
  if (
    input.action === 'insert' &&
    (!input.reference ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(input.reference.paperId) ||
      !input.reference.title?.trim())
  )
    return Promise.reject(new Error('请填写并保存文献标题'));
  busy = true;
  return new Promise((resolve, reject) => {
    const executable = path.join(
      process.env.SystemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const child = spawn(
      executable,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        ...(testMode ? ['-TestMode'] : []),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '',
      errors = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30000);
    child.stdin.on('error', () => {
      /* close/error handlers report the process failure. */
    });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      busy = false;
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      busy = false;
      if (code !== 0) {
        reject(
          new Error(
            'Word 操作未完成：' +
              (timedOut
                ? '操作超时，请检查 Word 弹窗及文档内容后再操作'
                : errors.trim().slice(0, 500) || '请检查 Word 是否有弹窗，然后重试'),
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(output.trim()));
      } catch {
        reject(new Error('无法读取 Word 操作结果'));
      }
    });
    child.stdin.end(data);
  });
}
module.exports = { runWord };
