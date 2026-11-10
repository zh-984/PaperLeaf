'use client';
import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import type { WorkTask } from '@/lib/work';
export function workHistoryLabel(task: WorkTask) {
  const method =
    task.kind === 'similarity'
      ? '公开来源查重'
      : task.results.engine === 'local'
        ? '中文专用检测'
        : task.results.engine === 'detector'
          ? '外部专用检测'
          : 'AI 辅助分析';
  const status =
    task.status === 'running'
      ? '进行中'
      : task.status === 'failed'
        ? '失败'
        : task.status === 'cancelled'
          ? '已取消'
          : task.results.failedParagraphs
            ? '部分待重试'
            : '已完成';
  return `${method}${task.results.model ? ' · ' + task.results.model : ''} · ${new Date(task.createdAt).toLocaleString('zh-CN')} · ${status}`;
}
export function WorkHistory({
  tasks,
  selected,
  onSelect,
  onDelete,
}: {
  tasks: WorkTask[];
  selected?: string;
  onSelect: (id: string) => void;
  onDelete: (task: WorkTask) => void;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) root.current?.removeAttribute('open');
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') root.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, []);
  if (!tasks.length) return null;
  const current = tasks.find((t) => t.id === selected) || tasks[0];
  return (
    <details ref={root} className="work-history">
      <summary title={workHistoryLabel(current)}>历史记录 · {workHistoryLabel(current)}</summary>
      <div className="work-history-list" aria-label="Work 历史记录列表">
        {tasks.map((task) => (
          <div className="work-history-row" key={task.id}>
            <button
              aria-current={task.id === selected ? 'true' : undefined}
              onClick={() => {
                onSelect(task.id);
                root.current?.removeAttribute('open');
              }}
            >
              {workHistoryLabel(task)}
            </button>
            <button
              aria-label={`删除历史记录 ${workHistoryLabel(task)}`}
              title={task.status === 'running' ? '请先取消任务' : '删除这次历史记录和报告'}
              disabled={task.status === 'running'}
              onClick={() => {
                root.current?.removeAttribute('open');
                onDelete(task);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
