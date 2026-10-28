'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CloudOff,
  FilePenLine,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import type { Note, ReadingAnchor } from '@/lib/types';
import { api, ClientError } from '@/lib/api';
import { Button } from './ui/button';
import { numberedNotes } from '@/lib/note-order';

function NoteEditor({
  note,
  onSaved,
  onDelete,
  onJump,
  onError,
  active,
  number,
}: {
  note: Note;
  onSaved: (note: Note) => void;
  onDelete: (id: string) => Promise<void>;
  onJump: (page: number, quote: string, anchor?: ReadingAnchor | null) => void;
  onError: (message: string) => void;
  active?: boolean;
  number: number;
}) {
  const [content, setContent] = useState(note.content);
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [recovered, setRecovered] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = '0';
      input.style.height = `${Math.min(400, Math.max(60, input.scrollHeight))}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(input);
    return () => observer.disconnect();
  }, [content]);
  useEffect(() => {
    if (active) {
      cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      cardRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
    }
  }, [active]);
  const key = `paperleaf:note:${note.id}`;
  const latest = useRef(note.content);
  const saved = useRef(note.content);
  const version = useRef(note.version);
  const chain = useRef(Promise.resolve());
  const deleted = useRef(false);
  const conflict = useRef(false);
  const callbacks = useRef({ onSaved, onError });
  useEffect(() => {
    callbacks.current = { onSaved, onError };
  }, [onSaved, onError]);
  const save = useCallback(() => {
    chain.current = chain.current.then(async () => {
      if (deleted.current || conflict.current || latest.current === saved.current) return;
      const draft = latest.current;
      setStatus('saving');
      try {
        const result = await api<Note>(`/api/papers/${note.paperId}/notes/${note.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            content: draft,
            page: note.page,
            selectedText: note.selectedText,
            source: note.source,
            version: version.current,
          }),
        });
        version.current = result.version;
        saved.current = draft;
        try {
          if (latest.current === draft) localStorage.removeItem(key);
          else
            localStorage.setItem(
              key,
              JSON.stringify({ content: latest.current, baseVersion: version.current }),
            );
        } catch {
          callbacks.current.onError('笔记已保存到数据库，但浏览器草稿存储不可用');
        }
        setStatus(latest.current === draft ? 'saved' : 'pending');
        callbacks.current.onSaved(result);
      } catch (cause) {
        if (cause instanceof ClientError && cause.status === 409) {
          conflict.current = true;
          setHasConflict(true);
        }
        setStatus('error');
        callbacks.current.onError(
          cause instanceof Error ? cause.message : '笔记保存失败，本机草稿已保留',
        );
      }
    });
    return chain.current;
  }, [key, note.id, note.paperId, note.page, note.selectedText, note.source]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      let draft = raw;
      let baseVersion = note.version;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === 'object' &&
          'content' in parsed &&
          typeof parsed.content === 'string'
        ) {
          draft = parsed.content;
          if ('baseVersion' in parsed && typeof parsed.baseVersion === 'number')
            baseVersion = parsed.baseVersion;
        }
      } catch {
        /* Recover legacy plain text drafts as well. */
      }
      if (draft !== saved.current) {
        latest.current = draft;
        setContent(draft);
        setRecovered(true);
        if (baseVersion !== note.version) {
          conflict.current = true;
          setHasConflict(true);
          setStatus('error');
        } else setStatus('pending');
      } else localStorage.removeItem(key);
    } catch {
      callbacks.current.onError('浏览器草稿存储不可用，请留意服务端保存状态');
    }
  }, [key, note.version]);
  useEffect(() => {
    if (content === saved.current) return;
    const timer = setTimeout(() => {
      void save();
    }, 650);
    return () => clearTimeout(timer);
  }, [content, save]);
  useEffect(() => {
    const flush = () => {
      void save();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      void save();
    };
  }, [save]);
  function change(value: string) {
    latest.current = value;
    setContent(value);
    setStatus('pending');
    try {
      localStorage.setItem(key, JSON.stringify({ content: value, baseVersion: version.current }));
    } catch {
      callbacks.current.onError('本机草稿空间不足，正在尝试保存到数据库');
    }
  }
  async function remove() {
    deleted.current = true;
    await chain.current;
    try {
      await onDelete(note.id);
      try {
        localStorage.removeItem(key);
      } catch {
        /* The database deletion already succeeded. */
      }
    } catch (cause) {
      deleted.current = false;
      callbacks.current.onError(cause instanceof Error ? cause.message : '删除失败');
    }
  }
  return (
    <article className={`note-card ${active ? 'active' : ''}`} ref={cardRef} data-note-id={note.id}>
      <header>
        <span>
          <b className="note-number">（{number}）</b>
          {note.page ? (
            <button
              title="定位到原文中的对应位置"
              onClick={() => onJump(note.page!, note.selectedText, note.anchor)}
            >
              p.{note.page}
              {note.anchor && ' · 回到原文'}
              <ArrowUpRight size={11} />
            </button>
          ) : (
            '随手记'
          )}
          <small>
            {note.source === 'ai'
              ? 'AI 回答'
              : note.source === 'excerpt'
                ? '原文与解释'
                : '手动笔记'}
          </small>
        </span>
        <button aria-label="删除笔记" onClick={() => void remove()}>
          <Trash2 size={14} />
        </button>
      </header>
      {recovered && <div className="draft-notice">已恢复本机未保存草稿</div>}
      {hasConflict && (
        <div className="draft-conflict">
          <p>草稿与已保存版本不同，自动保存已暂停。请复制草稿，刷新后对照。</p>
          <button
            onClick={() => {
              latest.current = note.content;
              saved.current = note.content;
              version.current = note.version;
              conflict.current = false;
              setHasConflict(false);
              setContent(note.content);
              setStatus('saved');
              try {
                localStorage.removeItem(key);
              } catch {
                /* Browser storage is optional. */
              }
            }}
          >
            采用服务器已保存内容
          </button>
        </div>
      )}
      <textarea
        ref={inputRef}
        rows={2}
        aria-label="笔记内容"
        placeholder="写下你的理解、疑问或下一步想法…"
        value={content}
        onChange={(event) => change(event.target.value)}
        onBlur={() => void save()}
        maxLength={100000}
      />
      <footer className={`save-status ${status}`}>
        {status === 'saving' ? (
          <LoaderCircle size={11} className="spin" />
        ) : status === 'saved' ? (
          <Check size={11} />
        ) : status === 'error' ? (
          <CloudOff size={11} />
        ) : (
          <span className="pending-dot" />
        )}
        {status === 'saved'
          ? '已保存到本机'
          : status === 'saving'
            ? '保存中…'
            : status === 'error'
              ? '保存失败 · 草稿保留'
              : '等待自动保存'}
        {status === 'error' && (
          <button
            onClick={() => {
              if (conflict.current) {
                callbacks.current.onError('存在版本冲突，请复制当前草稿，再刷新对照服务器内容');
                return;
              }
              void save();
            }}
          >
            重试
          </button>
        )}
      </footer>
    </article>
  );
}
export function NotesPanel({
  notes,
  currentPage = 1,
  activeNoteId = null,
  onAdd,
  onSaved,
  onDelete,
  onJump,
  onError,
}: {
  notes: Note[];
  currentPage?: number;
  activeNoteId?: string | null;
  onAdd: () => Promise<void>;
  onSaved: (note: Note) => void;
  onDelete: (id: string) => Promise<void>;
  onJump: (page: number, quote: string, anchor?: ReadingAnchor | null) => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const pageNotes = notes.filter(
    (note) =>
      note.page === currentPage ||
      note.anchor?.locations.some((location) => location.page === currentPage),
  );
  const visible =
    scope === 'all'
      ? notes
      : notes.filter((note) => pageNotes.includes(note) || note.id === activeNoteId);
  const ordered = numberedNotes(notes).filter(({ note }) => visible.includes(note));
  return (
    <div className="notes-panel">
      <div className="notes-heading">
        <span>{notes.length} 条思考，留在这里</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={adding}
          onClick={async () => {
            setAdding(true);
            try {
              await onAdd();
            } finally {
              setAdding(false);
            }
          }}
        >
          <Plus size={14} />
          新建笔记
        </Button>
      </div>
      <div className="notes-scope">
        <button className={scope === 'page' ? 'active' : ''} onClick={() => setScope('page')}>
          本页 {pageNotes.length}
        </button>
        <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
          全部 {notes.length}
        </button>
        <small>第 {currentPage} 页 · 随阅读定位</small>
      </div>
      {!visible.length && (
        <div className="panel-empty">
          <FilePenLine size={30} strokeWidth={1.2} />
          <h3>把读过的，变成自己的</h3>
          <p>划选原文点“记笔记”，想法会与原句相连。也可以新建当前阅读位置的笔记，自动保存。</p>
        </div>
      )}
      {ordered.map(({ note, number }) => (
        <NoteEditor
          key={note.id}
          note={note}
          number={number}
          active={activeNoteId === note.id}
          onSaved={onSaved}
          onDelete={onDelete}
          onJump={onJump}
          onError={onError}
        />
      ))}
    </div>
  );
}
