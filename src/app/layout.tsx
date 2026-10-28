import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '知页 Paperleaf · 极简文献解读器',
  description: '先读懂，再深入。保存在本机的文献解读与阅读空间。',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
