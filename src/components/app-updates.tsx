'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { UpdateState } from '@/lib/desktop';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
const UpdateContext = createContext<{ state: UpdateState | null; busy: boolean; show: () => void }>(
  { state: null, busy: false, show: () => {} },
);
export function AppUpdates({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UpdateState | null>(null),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false);
  const check = useCallback(async (force = false) => {
    if (!window.paperleafDesktop?.update) return;
    setBusy(true);
    try {
      setState(await window.paperleafDesktop.update(force ? 'check' : 'status'));
    } catch {
      setState({
        status: 'error',
        currentVersion: '',
        latestVersion: '',
        notes: '',
        url: '',
        error: '检查更新失败，请稍后重试',
      });
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void check();
    }, 8000);
    const interval = setInterval(() => {
      void check();
    }, 86400000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [check]);
  const show = useCallback(() => {
    setOpen(true);
    void check();
  }, [check]);
  return (
    <UpdateContext.Provider value={{ state, busy, show }}>
      {children}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={state?.status === 'available' ? `发现新版 ${state.latestVersion}` : '检查更新'}
        description="只检查官方版本信息，不发送文献、稿件或 API Key。"
      >
        <div className="app-update-content">
          {state?.currentVersion && <p>当前版本 {state.currentVersion}</p>}
          {busy ? (
            <p role="status">正在检查…</p>
          ) : state?.status === 'current' ? (
            <p>当前已是最新正式版。</p>
          ) : state?.status === 'error' ? (
            <p role="alert">{state.error}</p>
          ) : null}
          {state?.status === 'available' && (
            <>
              <pre>{state.notes || '本次更新包含功能与体验改进。'}</pre>
              <p>
                打开官方下载页获取安装包。安装前请保存笔记并退出知页；更新保留本机数据与 AI 配置。
              </p>
            </>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" disabled={busy} onClick={() => void check(true)}>
              <RefreshCw size={14} />
              重新检查
            </Button>
            {state?.status === 'available' && (
              <Button
                onClick={() => {
                  void window.paperleafDesktop?.update?.('open').catch(() =>
                    setState({
                      ...state,
                      status: 'error',
                      error: '无法打开下载页面，请稍后重试',
                    }),
                  );
                }}
              >
                <Download size={14} />
                下载新版
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </UpdateContext.Provider>
  );
}
export function UpdateBadge() {
  const { state, show } = useContext(UpdateContext);
  return state?.status === 'available' ? (
    <button
      className="update-badge"
      title={`新版 ${state.latestVersion} 可用`}
      aria-label="查看可用更新"
      onClick={show}
    >
      new
    </button>
  ) : null;
}
export function CheckUpdates() {
  const { busy, show } = useContext(UpdateContext);
  return (
    <Button variant="secondary" disabled={busy} onClick={show}>
      检查更新
    </Button>
  );
}
