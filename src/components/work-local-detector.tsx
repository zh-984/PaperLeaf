'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Download, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { LocalDetectorState } from '@/lib/work';
import { Button } from './ui/button';
export function WorkLocalDetector({
  state,
  onChange,
  onError,
  onReady,
}: {
  state: LocalDetectorState | null;
  onChange: (value: LocalDetectorState) => void;
  onError: (message: string) => void;
  onReady: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (state?.status !== 'downloading') return;
    const timer = setInterval(() => {
      void api<LocalDetectorState>('/api/work/local-detector')
        .then((next) => {
          onChange(next);
          if (next.ready) onReady();
        })
        .catch(() => onError('读取模型下载进度失败，可稍后重试'));
    }, 1200);
    return () => clearInterval(timer);
  }, [state?.status, onChange, onError, onReady]);
  if (!state) return null;
  if (state.ready)
    return (
      <p className="work-local-ready">
        <CheckCircle2 size={14} />
        本地中文检测已就绪 · 离线运行，无需 Key
      </p>
    );
  const percent = Math.min(100, Math.round((state.downloadedBytes / state.totalBytes) * 100));
  return (
    <div className="work-local-model" aria-label="本地中文检测器">
      <div>
        <strong>
          {state.ready ? (
            <>
              <CheckCircle2 size={15} />
              本地中文检测已就绪
            </>
          ) : (
            '免费本地中文检测'
          )}
        </strong>
        <p>
          正文不外发，不需要 Key。模型约 {Math.round(state.totalBytes / 1024 / 1024)}{' '}
          MiB，首次下载后可离线使用；短段和非中文段落不评分。
        </p>
      </div>
      {!state.ready && (
        <Button
          variant="secondary"
          disabled={busy || state.status === 'downloading'}
          onClick={() => {
            setBusy(true);
            void api<LocalDetectorState>('/api/work/local-detector', {
              method: 'POST',
              body: JSON.stringify({ force: state.status === 'error' }),
            })
              .then((next) => {
                onChange(next);
                if (next.ready) onReady();
              })
              .catch((cause) => onError(cause instanceof Error ? cause.message : '下载失败'))
              .finally(() => setBusy(false));
          }}
        >
          {busy || state.status === 'downloading' ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Download size={15} />
          )}
          {state.status === 'downloading'
            ? `下载中 ${percent}%`
            : state.status === 'error'
              ? '重新下载模型'
              : '下载并启用'}
        </Button>
      )}
      {state.status === 'downloading' && (
        <progress aria-label="模型下载进度" value={state.downloadedBytes} max={state.totalBytes} />
      )}
      {state.error && <p role="alert">{state.error}。AI 辅助分析仍可使用。</p>}
    </div>
  );
}
