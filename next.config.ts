import type { NextConfig } from 'next';

const config: NextConfig = {
  output: process.env.PAPERLEAF_DESKTOP_BUILD === '1' ? 'standalone' : undefined,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  devIndicators: false,
  typescript: { tsconfigPath: process.env.NEXT_TEST_TSCONFIG || 'tsconfig.json' },
  serverExternalPackages: ['@prisma/client', 'pdfjs-dist'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
