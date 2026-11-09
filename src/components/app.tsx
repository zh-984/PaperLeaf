'use client';
import { Activity, useCallback, useEffect, useRef, useState } from 'react';
import { Workspace } from './workspace';
import { WorkSpace } from './work-space';
import { api } from '@/lib/api';
export function App() {
  const [mode, setMode] = useState<'read' | 'work' | null>(null);
  const [error, setError] = useState('');
  const [visited, setVisited] = useState<('read' | 'work')[]>([]);
  const [pending, setPending] = useState<'read' | 'work' | null>(null);
  const pendingRef = useRef<'read' | 'work' | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ mode: 'read' | 'work' }>('/api/work/state')
      .then((state) => {
        if (live) {
          const initial = state.mode === 'work' ? 'work' : 'read';
          setMode(initial);
          setVisited([initial]);
        }
      })
      .catch(() => {
        if (live) {
          const initial = localStorage.getItem('paperleaf-mode') === 'work' ? 'work' : 'read';
          setMode(initial);
          setVisited([initial]);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  const ready = useCallback((value: 'read' | 'work') => {
    if (pendingRef.current !== value) return;
    pendingRef.current = null;
    setPending(null);
    localStorage.setItem('paperleaf-mode', value);
    setMode(value);
    void api('/api/work/state', {
      method: 'PATCH',
      body: JSON.stringify({ mode: value }),
      keepalive: true,
    }).catch(() => setError('模式记忆未保存，可稍后重试；当前仍可使用。'));
  }, []);
  const readReady = useCallback(() => ready('read'), [ready]);
  const workReady = useCallback(() => ready('work'), [ready]);
  function change(value: 'read' | 'work') {
    if (value === mode) {
      pendingRef.current = null;
      setPending(null);
      return;
    }
    pendingRef.current = value;
    setPending(value);
    setVisited((current) => (current.includes(value) ? current : [...current, value]));
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
      {visited.map((value) => (
        <div
          key={value}
          className="mode-pane"
          data-current={mode === value}
          aria-hidden={mode !== value}
          inert={mode !== value}
        >
          <Activity mode={mode === value || pending === value ? 'visible' : 'hidden'}>
            {value === 'read' ? (
              <Workspace active={mode === 'read'} onReady={readReady} onModeChange={change} />
            ) : (
              <WorkSpace active={mode === 'work'} onReady={workReady} onModeChange={change} />
            )}
          </Activity>
        </div>
      ))}
      {pending && (
        <div className="mode-switch-status" role="status">
          正在切换到 {pending === 'read' ? 'Read' : 'Work'}…
        </div>
      )}
    </>
  );
}
