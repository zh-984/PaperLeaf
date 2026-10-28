import 'dotenv/config';
import path from 'node:path';

function positiveInt(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}
export const dataDir = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || './data');
export const uploadDir = path.join(dataDir, 'uploads');
export const tempDir = path.join(dataDir, 'tmp');
export const maxUploadMB = positiveInt(process.env.MAX_UPLOAD_MB, 50, 500);
export const maxUploadBytes = maxUploadMB * 1024 * 1024;
export const maxUploadFiles = positiveInt(process.env.MAX_UPLOAD_FILES, 10, 100);
export const aiTimeout = positiveInt(process.env.AI_TIMEOUT_MS, 120000, 300000);
export const aiMaxInput = Math.max(
  8000,
  positiveInt(process.env.AI_MAX_INPUT_CHARS, 14000, 300000),
);
export const aiMaxOutput = positiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 3000, 10000);
export const aiChunkChars = Math.max(512, positiveInt(process.env.AI_CHUNK_CHARS, 10000, 20000));
