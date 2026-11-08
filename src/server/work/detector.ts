import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { z } from 'zod';
import { dataDir } from '../config';
const file = () => path.join(dataDir, 'work-detector.env');
export function getWorkDetector() {
  const saved = existsSync(file()) ? parse(readFileSync(file())) : {};
  return {
    url: saved.WORK_DETECTOR_URL ?? process.env.WORK_DETECTOR_URL ?? '',
    key: saved.WORK_DETECTOR_KEY ?? process.env.WORK_DETECTOR_KEY ?? '',
    model: saved.WORK_DETECTOR_MODEL ?? process.env.WORK_DETECTOR_MODEL ?? '',
  };
}
export const detectorSettingsSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return (
          ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash
        );
      } catch {
        return false;
      }
    }, '请输入有效的 HTTP(S) 检测接口'),
  model: z.string().trim().max(200),
  key: z
    .string()
    .trim()
    .max(4096)
    .regex(/^[^\r\n]*$/)
    .optional(),
  clearKey: z.boolean().default(false),
});
export function detectorDto() {
  const config = getWorkDetector();
  return {
    detector: !!config.url,
    detectorUrl: config.url,
    detectorModel: config.model || '专用检测器',
    detectorHasKey: !!config.key,
  };
}
export function saveWorkDetector(input: z.infer<typeof detectorSettingsSchema>) {
  const current = getWorkDetector();
  mkdirSync(dataDir, { recursive: true });
  const temporary = file() + '.' + randomUUID() + '.tmp';
  writeFileSync(
    temporary,
    Object.entries({
      WORK_DETECTOR_URL: input.url,
      WORK_DETECTOR_KEY: input.clearKey ? '' : input.key || current.key,
      WORK_DETECTOR_MODEL: input.model,
    })
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n'),
    { mode: 0o600 },
  );
  renameSync(temporary, file());
  return detectorDto();
}
