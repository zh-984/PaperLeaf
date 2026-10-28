import { cp, mkdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';

await mkdir('data/uploads', { recursive: true });
await mkdir('data/tmp', { recursive: true });
try {
  await access('.env');
} catch {
  await copyFile('.env.example', '.env');
}
const databaseUrl = process.env.DATABASE_URL || 'file:../data/library.db';
if (databaseUrl.startsWith('file:')) {
  const configured = databaseUrl.slice(5);
  const databasePath = path.isAbsolute(configured)
    ? configured
    : path.resolve('prisma', configured);
  await mkdir(path.dirname(databasePath), { recursive: true });
  // Pre-create the file: Prisma's schema engine on Windows can fail on a missing SQLite file.
  new DatabaseSync(databasePath).close();
}
const source = path.resolve('node_modules/pdfjs-dist');
await mkdir('public/pdfjs', { recursive: true });
await copyFile(path.join(source, 'build/pdf.worker.min.mjs'), 'public/pdfjs/pdf.worker.min.mjs');
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(source, folder), path.join('public/pdfjs', folder), { recursive: true });
}
console.log('Local data directories, .env and PDF.js assets are ready.');
