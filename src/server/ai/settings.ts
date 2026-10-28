import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { z } from 'zod';
import { dataDir } from '../config';

export const aiSettingsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, '请输入有效的 API 服务地址'),
  model: z
    .string()
    .trim()
    .min(1, '请填写模型名称')
    .max(200)
    .regex(/^[^\r\n]+$/),
  apiKey: z
    .string()
    .trim()
    .max(4096)
    .regex(/^[^\r\n]*$/)
    .optional(),
  clearKey: z.boolean().optional(),
});
export function configFilePath() {
  return process.env.PAPERLEAF_PROFILE
    ? path.join(process.env.PAPERLEAF_PROFILE, 'ai.env')
    : path.join(dataDir, 'ai.env');
}
export function normalizeBaseUrl(value: string) {
  const url = new URL(value.replace(/\/+$/, '').replace(/\/chat\/completions$/, ''));
  if (url.pathname === '/') url.pathname = '/v1';
  return url.href.replace(/\/+$/, '');
}
export function getAiConfig() {
  const file = configFilePath();
  const saved = existsSync(file) ? parse(readFileSync(file)) : {};
  const apiKey = saved.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  return {
    apiKey,
    model: saved.OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseUrl: (
      saved.OPENAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://api.openai.com/v1'
    ).replace(/\/+$/, ''),
    enabled: Boolean(apiKey.trim()) && (saved.AI_ENABLED ?? process.env.AI_ENABLED) !== 'false',
  };
}
export function saveAiConfig(input: z.infer<typeof aiSettingsSchema>) {
  const previous = getAiConfig();
  const key = input.clearKey ? '' : input.apiKey || previous.apiKey;
  const file = configFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(
    temporary,
    `# 知页：通过应用内 AI 配置修改。阅读参数已预设。\nAI_ENABLED=${key ? 'true' : 'false'}\nOPENAI_BASE_URL=${JSON.stringify(normalizeBaseUrl(input.baseUrl))}\nOPENAI_API_KEY=${JSON.stringify(key)}\nOPENAI_MODEL=${JSON.stringify(input.model)}\n`,
    { mode: 0o600 },
  );
  renameSync(temporary, file);
}
