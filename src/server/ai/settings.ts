import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { z } from 'zod';
import { dataDir } from '../config';

export const aiSettingsSchema = z.object({
  slot: z.number().int().min(1).max(3).default(1),
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
export function getAiConfig(slot = 1) {
  const file = configFilePath();
  const saved = existsSync(file) ? parse(readFileSync(file)) : {};
  const prefix = slot === 1 ? '' : `PROFILE_${slot}_`;
  const lookup = (key: string) =>
    saved[prefix + key] ?? (slot === 1 ? process.env[key] : undefined);
  const apiKey = lookup('OPENAI_API_KEY') ?? '';
  return {
    apiKey,
    model: lookup('OPENAI_MODEL') || (slot === 1 ? 'gpt-4o-mini' : ''),
    baseUrl: (lookup('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    enabled: Boolean(apiKey.trim()) && lookup('AI_ENABLED') !== 'false',
  };
}
export function saveAiConfig(input: z.infer<typeof aiSettingsSchema>) {
  const previous = getAiConfig(input.slot);
  const key = input.clearKey ? '' : input.apiKey || previous.apiKey;
  const file = configFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const saved = existsSync(file) ? parse(readFileSync(file)) : {};
  const prefix = input.slot === 1 ? '' : `PROFILE_${input.slot}_`;
  saved[`${prefix}AI_ENABLED`] = key ? 'true' : 'false';
  saved[`${prefix}OPENAI_BASE_URL`] = normalizeBaseUrl(input.baseUrl);
  saved[`${prefix}OPENAI_API_KEY`] = key;
  saved[`${prefix}OPENAI_MODEL`] = input.model;
  writeFileSync(
    temporary,
    `# 知页：AI 配置保存在本机。\n${Object.entries(saved)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join('\n')}\n`,
    { mode: 0o600 },
  );
  renameSync(temporary, file);
}
