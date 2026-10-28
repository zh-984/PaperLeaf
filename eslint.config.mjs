import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { 'react-hooks/set-state-in-effect': 'off' } },
  { files: ['desktop/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  globalIgnores([
    '.next/**',
    '.next-*/**',
    '.desktop-build/**',
    '.desktop-cache/**',
    'release/**',
    'node_modules/**',
    'public/pdfjs/**',
    'data/**',
    '.test-data/**',
    'test-results/**',
    'playwright-report/**',
    'next-env.d.ts',
  ]),
]);
