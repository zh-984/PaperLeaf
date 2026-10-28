'use client';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fatal-error">
      <h1>这个阅读空间暂时遇到了一点问题</h1>
      <p>文献仍保存在本机。请重试，或检查终端中的服务日志。</p>
      <Button onClick={reset}>重新加载</Button>
    </main>
  );
}
