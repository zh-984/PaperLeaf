import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import { dataDir } from './config';

const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  globalDb.prisma ??
  new PrismaClient({
    datasourceUrl:
      process.env.DATABASE_URL || `file:${path.join(dataDir, 'library.db').replaceAll('\\', '/')}`,
  });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
