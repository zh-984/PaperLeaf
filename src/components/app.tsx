'use client';
import { useEffect, useState } from 'react';
import { Workspace } from './workspace';
import { WorkSpace } from './work-space';
import { api } from '@/lib/api';
export function App() {
  const [mode, setMode] = useState<'read' | 'work' | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void api<{ mode: 'read' | 'work' }>('/api/work/state')
      .then((state) => {
        if (live) setMode(state.mode === 'work' ? 'work' : 'read');
      })
      .catch(() => {
        if (live) setMode(localStorage.getItem('paperleaf-mode') === 'work' ? 'work' : 'read');
      });
    return () => {
      live = false;
    };
  }, []);
  function change(value: 'read' | 'work') {
    localStorage.setItem('paperleaf-mode', value);
    setMode(value);
    void api('/api/work/state', {
      method: 'PATCH',
      body: JSON.stringify({ mode: value }),
      keepalive: true,
    }).catch(() => setError('模式记忆未保存，可稍后重试；当前仍可使用。'));
  }
  if (!mode)
    return (
      <div role="status" className="work-empty">
        正在打开本地工作区…
      </div>
    );
  return (
    <>
      {error && (
        <div role="alert">
          {error}
          <button onClick={() => setError('')}>关闭</button>
        </div>
      )}
      {mode === 'read' ? <Workspace onModeChange={change} /> : <WorkSpace onModeChange={change} />}
    </>
  );
}
