'use client';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Leaf,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import type { AppSettings, Bookshelf, Paper } from '@/lib/types';
import { api } from '@/lib/api';
import { dateLabel } from '@/lib/utils';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { statusLabels } from '@/lib/status';

export function ProjectShelf({
  papers,
  shelves,
  setShelves,
  activeId,
  activeShelfId,
  onShelfSelect,
  onSelect,
  onUpload,
  uploadMessage,
  onRename,
  onDelete,
  onMove,
  onShelfDeleted,
  onSettings,
  open,
  onClose,
  settings,
  onError,
  defaultCollapsed,
  onDefaultCollapse,
  createSignal,
}: {
  papers: Paper[];
  shelves: Bookshelf[];
  setShelves: Dispatch<SetStateAction<Bookshelf[]>>;
  activeId: string | null;
  activeShelfId: string | null;
  onShelfSelect: (id: string | null) => void;
  onSelect: (id: string) => void;
  onUpload: () => void;
  uploadMessage: string;
  onRename: (paper: Paper) => void;
  onDelete: (paper: Paper) => void;
  onMove: (paper: Paper, shelfId: string | null) => Promise<void>;
  onShelfDeleted: (id: string) => void;
  onSettings: () => void;
  open: boolean;
  onClose: () => void;
  settings: AppSettings | null;
  onError: (message: string) => void;
  defaultCollapsed: boolean;
  onDefaultCollapse: (value: boolean) => void;
  createSignal: number;
}) {
  const [query, setQuery] = useState(''),
    [draft, setDraft] = useState<{ id: string | null; name: string } | null>(null),
    [deleting, setDeleting] = useState<Bookshelf | null>(null),
    [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null),
    queues = useRef(new Map<string, Promise<void>>()),
    intents = useRef(new Map<string, number>());
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      rootRef.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => {
        if (event instanceof KeyboardEvent || !menu.contains(event.target as Node))
          menu.open = false;
      });
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close);
    };
  }, []);
  useEffect(() => {
    if (createSignal) setDraft({ id: null, name: '' });
  }, [createSignal]);
  useEffect(() => {
    const search = () => searchRef.current?.focus();
    window.addEventListener('paperleaf:search', search);
    return () => window.removeEventListener('paperleaf:search', search);
  }, []);
  async function toggle(shelf: Bookshelf) {
    const collapsed = !shelf.collapsed,
      revision = (intents.current.get(shelf.id) || 0) + 1;
    intents.current.set(shelf.id, revision);
    setShelves((items) =>
      items.map((item) => (item.id === shelf.id ? { ...item, collapsed } : item)),
    );
    const chain = (queues.current.get(shelf.id) || Promise.resolve())
      .then(async () => {
        await api(`/api/bookshelves/${shelf.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ collapsed }),
        });
      })
      .catch(() => {
        if (intents.current.get(shelf.id) === revision)
          setShelves((items) =>
            items.map((item) =>
              item.id === shelf.id ? { ...item, collapsed: shelf.collapsed } : item,
            ),
          );
        onError('书架折叠状态保存失败，请重试');
      });
    queues.current.set(shelf.id, chain);
    await chain;
    if (queues.current.get(shelf.id) === chain) queues.current.delete(shelf.id);
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const result = await api<Bookshelf>(
        draft.id ? `/api/bookshelves/${draft.id}` : '/api/bookshelves',
        { method: draft.id ? 'PATCH' : 'POST', body: JSON.stringify({ name: draft.name }) },
      );
      if (draft.id)
        setShelves((items) =>
          items.map((item) => (item.id === result.id ? { ...item, name: result.name } : item)),
        );
      else {
        setShelves((items) => [...items, result]);
        onShelfSelect(result.id);
      }
      setDraft(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '保存书架失败');
    } finally {
      setBusy(false);
    }
  }
  const needle = query.trim().toLowerCase(),
    groups = [
      { id: null as string | null, name: '默认书架', collapsed: defaultCollapsed },
      ...shelves,
    ];
  const matches = (paper: Paper) =>
    (paper.title + ' ' + paper.fileName).toLowerCase().includes(needle);
  return (
    <>
      {open && <button className="shelf-backdrop" aria-label="关闭书架" onClick={onClose} />}
      <aside ref={rootRef} className={`shelf project-shelf ${open ? 'shelf-open' : ''}`}>
        <div className="brand">
          <span className="brand-icon">
            <Leaf size={22} />
          </span>
          <span>
            知页<span className="brand-en">PAPERLEAF</span>
          </span>
        </div>
        <button className="shelf-mobile-close" aria-label="关闭书架" onClick={onClose}>
          <X size={20} />
        </button>
        <Button className="shelf-upload" onClick={onUpload} disabled={!!uploadMessage}>
          {uploadMessage ? <LoaderCircle size={17} className="spin" /> : <Plus size={18} />}{' '}
          {uploadMessage || '导入文献'}
          <span className="upload-key">
            <Upload size={12} />
          </span>
        </Button>
        <span className="upload-destination">
          导入到：{groups.find((group) => group.id === activeShelfId)?.name || '默认书架'}
        </span>
        <label className="shelf-search">
          <Search size={14} />
          <input
            ref={searchRef}
            aria-label="搜索书架文献"
            placeholder="搜索标题或文件名"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button aria-label="清除书架搜索" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </label>
        <div className="shelf-label">
          <span>
            <BookOpen size={14} />
            我的书架 <small>{papers.length}</small>
          </span>
          <button
            aria-label="新建书架"
            title="新建项目书架"
            onClick={() => setDraft({ id: null, name: '' })}
          >
            <Plus size={17} />
          </button>
        </div>
        <nav className="shelf-list" aria-label="文献书架">
          {groups.map((group) => {
            const all = papers.filter((paper) => (paper.shelfId || null) === group.id),
              visible = all.filter(matches),
              expanded = needle ? true : !group.collapsed;
            if (needle && !visible.length && !group.name.toLowerCase().includes(needle))
              return null;
            const items = needle && group.name.toLowerCase().includes(needle) ? all : visible;
            return (
              <section
                className={`bookshelf-group ${activeShelfId === group.id ? 'selected' : ''}`}
                key={group.id || 'default'}
                data-testid="bookshelf-group"
                data-shelf-id={group.id || 'default'}
              >
                <div className="bookshelf-heading">
                  <button
                    className="bookshelf-name"
                    aria-expanded={expanded}
                    title={group.name}
                    onClick={() => {
                      onShelfSelect(group.id);
                      if (!needle) {
                        if (group.id) void toggle(shelves.find((shelf) => shelf.id === group.id)!);
                        else onDefaultCollapse(!defaultCollapsed);
                      }
                    }}
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>{group.name}</span>
                    <small>{all.length}</small>
                  </button>
                  <button
                    className="shelf-group-import"
                    aria-label={`导入到${group.name}`}
                    title="向此书架导入 PDF"
                    onClick={() => {
                      onShelfSelect(group.id);
                      requestAnimationFrame(onUpload);
                    }}
                  >
                    <Plus size={13} />
                  </button>
                  {group.id && (
                    <details className="bookshelf-menu">
                      <summary aria-label={`${group.name} 书架操作`}>
                        <MoreHorizontal size={15} />
                      </summary>
                      <div>
                        <button
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            setDraft({ id: group.id, name: group.name });
                          }}
                        >
                          重命名书架
                        </button>
                        <button
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            setDeleting(shelves.find((shelf) => shelf.id === group.id)!);
                          }}
                        >
                          删除书架
                        </button>
                      </div>
                    </details>
                  )}
                </div>
                {expanded && (
                  <div className="bookshelf-papers">
                    {!items.length && (
                      <div className="bookshelf-empty">
                        {needle ? '没有匹配的文献' : '还没有文献，点 + 导入'}
                      </div>
                    )}
                    {items.map((paper) => (
                      <div
                        className={`shelf-item ${paper.id === activeId ? 'active' : ''}`}
                        key={paper.id}
                      >
                        <button
                          className="paper-select"
                          aria-current={paper.id === activeId ? 'page' : undefined}
                          onClick={() => {
                            onShelfSelect(group.id);
                            onSelect(paper.id);
                            onClose();
                          }}
                        >
                          <span className="paper-glyph">
                            <FileText size={17} />
                          </span>
                          <span className="paper-mini">
                            <strong title={paper.title}>{paper.title}</strong>
                            <span className="paper-filename">{paper.fileName}</span>
                            <span className="paper-sub">
                              <i className={`status-dot ${paper.report?.status || 'idle'}`} />
                              {statusLabels[paper.report?.status || 'idle']}
                              <span>·</span>
                              {dateLabel(paper.createdAt)}
                            </span>
                            <span className="paper-position">
                              读到第 {paper.lastPage} 页 / {paper.pageCount} 页
                            </span>
                          </span>
                          <ChevronRight className="paper-arrow" size={12} />
                        </button>
                        <details className="paper-menu">
                          <summary aria-label={`${paper.title} 更多操作`}>
                            <MoreHorizontal size={16} />
                          </summary>
                          <div>
                            <button
                              onClick={(event) => {
                                event.currentTarget.closest('details')?.removeAttribute('open');
                                onRename(paper);
                              }}
                            >
                              重命名
                            </button>
                            <label className="move-paper-label">
                              移动到书架
                              <select
                                aria-label={`移动${paper.title}到书架`}
                                value={paper.shelfId || ''}
                                onChange={(event) => {
                                  const target = event.target.value || null;
                                  void onMove(paper, target).catch((error) =>
                                    onError(error instanceof Error ? error.message : '移动失败'),
                                  );
                                }}
                              >
                                {groups.map((target) => (
                                  <option key={target.id || 'default'} value={target.id || ''}>
                                    {target.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              className="text-danger"
                              onClick={(event) => {
                                event.currentTarget.closest('details')?.removeAttribute('open');
                                onDelete(paper);
                              }}
                            >
                              删除文献
                            </button>
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {needle &&
            !papers.some(matches) &&
            !groups.some((group) => group.name.toLowerCase().includes(needle)) && (
              <div className="shelf-empty">没有找到匹配的文献或书架</div>
            )}
        </nav>
        <div className="shelf-footer">
          <div className="local-badge">
            <ShieldCheck size={16} />
            <span>
              你的文献，只在本机
              <small>
                {settings?.aiEnabled ? 'AI 已连接 · 按需发送内容' : '本地优先 · AI 尚未配置'}
              </small>
            </span>
          </div>
          <button className="settings-button" onClick={onSettings} disabled={!settings}>
            <Settings2 size={16} />
            设置与隐私
            <ChevronRight size={14} />
          </button>
        </div>
      </aside>
      <Dialog
        open={!!draft}
        onOpenChange={(value) => {
          if (!value && !busy) setDraft(null);
        }}
        title={draft?.id ? '重命名书架' : '新建书架'}
        description="按项目、研究方向或课程给文献分类。"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor="bookshelf-name" className="field-label">
            书架名称
          </label>
          <input
            id="bookshelf-name"
            className="text-input"
            required
            maxLength={60}
            value={draft?.name || ''}
            onChange={(event) =>
              setDraft((current) => (current ? { ...current, name: event.target.value } : null))
            }
            placeholder="例如：电催化研究"
          />
          <div className="dialog-actions">
            <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !draft?.name.trim()}>
              {busy ? '保存中…' : '保存书架'}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value && !busy) setDeleting(null);
        }}
        title="删除这个书架？"
        description="其中的文献会回到默认书架，PDF、解读报告和笔记都会保留。"
      >
        <div className="dialog-actions">
          <Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (!deleting) return;
              setBusy(true);
              try {
                await api(`/api/bookshelves/${deleting.id}`, { method: 'DELETE' });
                setShelves((items) => items.filter((shelf) => shelf.id !== deleting.id));
                onShelfDeleted(deleting.id);
                setDeleting(null);
              } catch (error) {
                onError(error instanceof Error ? error.message : '删除书架失败');
              } finally {
                setBusy(false);
              }
            }}
          >
            删除书架
          </Button>
        </div>
      </Dialog>
    </>
  );
}
