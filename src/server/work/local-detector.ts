import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { InferenceSession } from 'onnxruntime-node';
import { Tokenizer } from '@huggingface/tokenizers';
import { dataDir } from '../config';
import { ApiError } from '../http';
import { tokenWindows } from './token-windows';
import type { WorkFinding, WorkParagraph, LocalDetectorState } from '@/lib/work';

export const LOCAL_MODEL_NAME = '中文 AIGC v3 · 本地 INT8';
export const LOCAL_MODEL_REVISION = 'e6c77fd62955fac134e76deb5396806f6d35fd30';
export const localModelDir = () =>
  path.resolve(process.env.WORK_LOCAL_MODEL_DIR || path.join(dataDir, 'models', 'aigc-zh-v3'));
const assets = [
  {
    name: 'model_quantized.onnx',
    remote: 'onnx/model_quantized.onnx',
    bytes: 103097593,
    hash: '57e5ec316f7ce764e94ba4f301cf492f3f22f22ea0cd3b385ebad847a42de40c',
  },
  {
    name: 'tokenizer.json',
    remote: 'tokenizer.json',
    bytes: 439118,
    hash: 'e3664152464ac6604e88e0b5348cb0819f5e2b75dc0a3f976dd4ab5058441b01',
  },
  {
    name: 'tokenizer_config.json',
    remote: 'tokenizer_config.json',
    bytes: 430,
    hash: '412cdf8e53b7a890e9c67c3eb93b7eaa93393f96e42ae5d306fbeb37cecfda2b',
  },
];
const totalBytes = assets.reduce((n, a) => n + a.bytes, 0);
type Runtime = {
  install?: Promise<void>;
  downloaded: number;
  error: string;
  session?: Promise<InferenceSession>;
  tokenizer?: Tokenizer;
  idle?: ReturnType<typeof setTimeout>;
  queue: Promise<unknown>;
};
const globalRuntime = globalThis as unknown as { paperleafLocalDetector?: Runtime };
const runtime = (globalRuntime.paperleafLocalDetector ??= {
  downloaded: 0,
  error: '',
  queue: Promise.resolve(),
});
function present() {
  return assets.every((a) => {
    try {
      return statSync(path.join(localModelDir(), a.name)).size === a.bytes;
    } catch {
      return false;
    }
  });
}
export function localDetectorState(): LocalDetectorState {
  const ready = !runtime.install && !runtime.error && present();
  return {
    ready,
    status: runtime.install ? 'downloading' : runtime.error ? 'error' : ready ? 'ready' : 'missing',
    downloadedBytes: ready ? totalBytes : runtime.downloaded,
    totalBytes,
    model: LOCAL_MODEL_NAME,
    error: runtime.error,
  };
}
async function hash(file: string) {
  const h = createHash('sha256');
  for await (const part of createReadStream(file)) h.update(part);
  return h.digest('hex');
}
function response(url: string, signal: AbortSignal, redirects = 0): Promise<IncomingMessage> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    !['huggingface.co', 'hf.co'].some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith('.' + host),
    )
  )
    throw new Error('模型下载跳转到了未允许的域名');
  if (redirects > 5) throw new Error('模型下载重定向过多');
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY;
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.get(
      parsed,
      {
        agent,
        signal,
        timeout: 30000,
        headers: { 'User-Agent': 'PaperLeaf-local-detector', 'Accept-Encoding': 'identity' },
      },
      (res) => {
        res.once('close', () => agent?.destroy());
        if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
          res.resume();
          response(new URL(res.headers.location, parsed).href, signal, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`模型下载返回 HTTP ${res.statusCode}`));
          return;
        }
        resolve(res);
      },
    );
    req.once('error', (error) => {
      agent?.destroy();
      reject(error);
    });
    req.once('timeout', () => req.destroy(new Error('模型下载连接超时')));
  });
}
export function startLocalInstall(force = false) {
  if (runtime.install) return { state: localDetectorState(), run: () => runtime.install! };
  if (localDetectorState().ready && !force)
    return { state: localDetectorState(), run: async () => {} };
  runtime.error = '';
  runtime.downloaded = 0;
  // Register synchronously before returning, so repeated clicks share one download.
  let launch!: () => void;
  const gate = new Promise<void>((resolve) => {
    launch = resolve;
  });
  runtime.install = gate
    .then(async () => {
      const signal = AbortSignal.timeout(300000);
      await mkdir(localModelDir(), { recursive: true });
      for (const asset of assets) {
        signal.throwIfAborted();
        const destination = path.join(localModelDir(), asset.name),
          temporary = destination + '.part';
        if (existsSync(destination) && (await hash(destination)) === asset.hash) {
          runtime.downloaded += asset.bytes;
          continue;
        }
        await rm(temporary, { force: true });
        try {
          const incoming = await response(
            `https://huggingface.co/Eslzzyl/aigc-detector-zh-onnx/resolve/${LOCAL_MODEL_REVISION}/${asset.remote}`,
            signal,
          );
          let received = 0;
          const digest = createHash('sha256');
          await pipeline(
            incoming,
            new Transform({
              transform(chunk: Buffer, _encoding, done) {
                received += chunk.length;
                runtime.downloaded += chunk.length;
                if (received > asset.bytes) {
                  done(new Error('模型大小与固定版本不符'));
                  return;
                }
                digest.update(chunk);
                done(null, chunk);
              },
            }),
            createWriteStream(temporary),
            { signal },
          );
          if (received !== asset.bytes || digest.digest('hex') !== asset.hash)
            throw new Error('模型完整性校验失败，未启用该文件');
          await rename(temporary, destination);
        } finally {
          await rm(temporary, { force: true });
        }
      }
    })
    .catch((error) => {
      runtime.error = error instanceof Error ? error.message : '模型下载失败';
    })
    .finally(() => {
      runtime.install = undefined;
    });
  return {
    state: localDetectorState(),
    run: async () => {
      launch();
      await runtime.install;
    },
  };
}
async function session() {
  if (!present()) throw new ApiError(503, '请先下载本地中文检测模型');
  if (!runtime.session) {
    runtime.session = (async () => {
      for (const a of assets)
        if ((await hash(path.join(localModelDir(), a.name))) !== a.hash)
          throw new Error('本地模型文件校验失败，请重新下载');
      const tokenizer = JSON.parse(
        await readFile(path.join(localModelDir(), 'tokenizer.json'), 'utf8'),
      );
      const config = JSON.parse(
        await readFile(path.join(localModelDir(), 'tokenizer_config.json'), 'utf8'),
      );
      runtime.tokenizer = new Tokenizer(tokenizer, config);
      const ort = await import('onnxruntime-node');
      return ort.InferenceSession.create(path.join(localModelDir(), 'model_quantized.onnx'), {
        executionProviders: ['cpu'],
        intraOpNumThreads: 2,
        interOpNumThreads: 1,
        executionMode: 'sequential',
        graphOptimizationLevel: 'all',
        enableCpuMemArena: false,
        enableMemPattern: false,
      });
    })().catch((error) => {
      runtime.session = undefined;
      runtime.error = error instanceof Error ? error.message : '本地推理初始化失败';
      throw error;
    });
  }
  return runtime.session;
}
export async function localFindings(
  paragraphs: WorkParagraph[],
  signal: AbortSignal,
): Promise<WorkFinding[]> {
  const previous = runtime.queue;
  const operation = previous
    .catch(() => {})
    .then(async () => {
      if (runtime.idle) clearTimeout(runtime.idle);
      const model = await session(),
        ort = await import('onnxruntime-node');
      const findings: WorkFinding[] = [];
      try {
        for (const p of paragraphs) {
          signal.throwIfAborted();
          const letters = p.text.match(/[\p{L}\p{N}]/gu) || [],
            chinese = p.text.match(/\p{Script=Han}/gu) || [];
          const base = {
            paragraphId: p.id,
            quote: p.text,
            start: 0,
            end: p.text.length,
            revision: '',
          };
          if (letters.length < 80 || chinese.length / Math.max(letters.length, 1) < 0.3) {
            findings.push({
              ...base,
              risk: 'unknown',
              reason:
                letters.length < 80
                  ? '有效文字过少，本段不评分。'
                  : '当前本地模型面向中文，本段语言不适用。',
              suggestion: '请结合上下文人工核对；英语内容可选 API 辅助分析或英文专用检测器。',
            });
            continue;
          }
          const windows = tokenWindows(
            runtime.tokenizer!.encode(p.text, { add_special_tokens: false }).ids,
          );
          let weighted = 0,
            weight = 0;
          for (const window of windows) {
            signal.throwIfAborted();
            const dims = [1, window.ids.length];
            const feeds = {
              input_ids: new ort.Tensor('int64', BigInt64Array.from(window.ids.map(BigInt)), dims),
              attention_mask: new ort.Tensor(
                'int64',
                new BigInt64Array(window.ids.length).fill(1n),
                dims,
              ),
              token_type_ids: new ort.Tensor('int64', new BigInt64Array(window.ids.length), dims),
            };
            const output = await model.run(feeds);
            const logits = output.logits || Object.values(output)[0];
            const values = Array.from(logits.data as Float32Array);
            if (values.length !== 2 || values.some((n) => !Number.isFinite(n)))
              throw new Error('本地模型返回了无效分数');
            const score = 1 / (1 + Math.exp(values[0] - values[1]));
            weighted += score * window.weight;
            weight += window.weight;
          }
          signal.throwIfAborted();
          const score = weighted / weight;
          findings.push({
            ...base,
            risk: score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low',
            score,
            reason:
              '本地中文专用模型的整段 AI 倾向评分，长段已分窗处理；这是模型判断，不是作者身份或逐字生成来源的证明。',
            suggestion:
              '核对事实、论据、引文与个人实际研究过程；需要具体修改建议时切换至 API 辅助分析。',
          });
        }
      } finally {
        runtime.idle = setTimeout(() => {
          const current = runtime.session;
          runtime.session = undefined;
          runtime.tokenizer = undefined;
          void current?.then((s) => s.release()).catch(() => {});
        }, 60000);
        runtime.idle.unref();
      }
      return findings;
    });
  runtime.queue = operation;
  return operation;
}
