'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  FilePenLine,
  FileText,
  Leaf,
  LoaderCircle,
  Menu,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { fileSize } from '@/lib/utils';
import { matchLinkedPapers } from '@/lib/linked-papers';
import type {
  AiAction,
  AiHistory,
  AppSettings,
  EvidencePoint,
  JumpTarget,
  Note,
  Paper,
  PaperDetail,
  ReportEvent,
  ReadingAnchor,
  SelectionContext,
  Bookshelf,
  AppPreferences,
} from '@/lib/types';
import { defaultPreferences } from '@/lib/types';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { ProjectShelf } from './project-shelf';
import { ReportView } from './report-view';
import { SidePanel } from './side-panel';
import { CitationView } from './citation-view';
import { SettingsWindow } from './settings-window';
import { DesktopTitlebar } from './desktop-titlebar';
import { desktopAction } from '@/lib/desktop';

const PdfReader = dynamic(() => import('./continuous-reader').then((module) => module.PdfReader), {
  ssr: false,
  loading: () => (
    <div className="reader-module-loading">
      <LoaderCircle className="spin" size={22} />
      准备阅读器…
    </div>
  ),
});
export function Workspace() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [detail, setDetail] = useState<PaperDetail | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [shelves, setShelves] = useState<Bookshelf[]>([]);
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null);
  const activeShelfRef = useRef<string | null>(null);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const preferencesRef = useRef(defaultPreferences),
    preferenceQueue = useRef(Promise.resolve()),
    preferenceRevision = useRef(0);
  const [settingsSection, setSettingsSection] = useState('general');
  const [shelfHidden, setShelfHidden] = useState(false),
    [createShelfSignal, setCreateShelfSignal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingPaper, setLoadingPaper] = useState(false);
  const [view, setView] = useState<'report' | 'original' | 'citation'>('report');
  const [panel, setPanel] = useState(false);
  const [panelTab, setPanelTab] = useState<'chat' | 'notes'>('chat');
  const [mobileShelf, setMobileShelf] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [jump, setJump] = useState<JumpTarget | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [aiSlot, setAiSlot] = useState(1);
  const [linkEnabled, setLinkEnabled] = useState(false);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<{ message: string; success: boolean } | null>(null);
  const [editing, setEditing] = useState<Paper | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [deleting, setDeleting] = useState<Paper | null>(null);
  const [mutating, setMutating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeId = useRef<string | null>(null);
  const requestNumber = useRef(0);
  const uploading = useRef(false);
  const pageQueue = useRef(Promise.resolve());
  const latestPage = useRef<{ id: string; page: number; position: number } | null>(null);
  const pageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback(
    (message: string, success = false) => setToast({ message, success }),
    [],
  );
  const onError = useCallback((message: string) => notify(message), [notify]);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    if (settings?.desktopMode)
      void desktopAction(`theme:${preferences.theme}`).catch(() => undefined);
  }, [preferences.theme, settings?.desktopMode]);
  const selectShelf = useCallback((id: string | null) => {
    activeShelfRef.current = id;
    setActiveShelfId(id);
  }, []);
  const openSettings = useCallback((section = 'general') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);
  const focusSearch = useCallback(() => {
    const settingsSearch = document.querySelector<HTMLInputElement>('[aria-label="搜索设置"]');
    if (settingsSearch) {
      settingsSearch.focus();
      return;
    }
    setShelfHidden(false);
    if (window.innerWidth <= 1100) setMobileShelf(true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>('[aria-label="搜索书架文献"]')?.focus(),
    );
  }, []);
  function changePreferences(patch: Partial<AppPreferences>) {
    const previous = preferencesRef.current,
      next = { ...previous, ...patch },
      revision = ++preferenceRevision.current;
    preferencesRef.current = next;
    setPreferences(next);
    preferenceQueue.current = preferenceQueue.current
      .then(async () => {
        await api('/api/preferences', { method: 'PATCH', body: JSON.stringify(patch) });
      })
      .catch((error: unknown) => {
        if (preferenceRevision.current === revision) {
          preferencesRef.current = previous;
          setPreferences(previous);
        }
        notify(error instanceof Error ? error.message : '设置保存失败');
      });
  }
  useEffect(() => {
    if (!toast?.success) return;
    const timer = setTimeout(
      () => setToast((current) => (current === toast ? null : current)),
      4500,
    );
    return () => clearTimeout(timer);
  }, [toast]);
  const openPaper = useCallback(
    async (id: string) => {
      const request = ++requestNumber.current;
      activeId.current = id;
      setLoadingPaper(true);
      setView(preferencesRef.current.defaultView);
      setSelection(null);
      setJump(null);
      setLinkEnabled(false);
      setLinkedIds([]);
      try {
        const paper = await api<PaperDetail>(`/api/papers/${id}`);
        if (request !== requestNumber.current) return;
        setDetail(paper);
        selectShelf(paper.shelfId || null);
        setActiveNoteId(null);
        try {
          localStorage.setItem('paperleaf:active', id);
        } catch {
          /* Reading works without browser storage. */
        }
        window.history.replaceState(null, '', `/?paper=${id}`);
      } catch (cause) {
        if (request === requestNumber.current)
          notify(cause instanceof Error ? cause.message : '文献加载失败');
      } finally {
        if (request === requestNumber.current) setLoadingPaper(false);
      }
    },
    [notify, selectShelf],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, config, groups, prefs] = await Promise.all([
        api<Paper[]>('/api/papers'),
        api<AppSettings>('/api/settings'),
        api<Bookshelf[]>('/api/bookshelves'),
        api<AppPreferences>('/api/preferences'),
      ]);
      setPapers(list);
      setSettings(config);
      setShelves(groups);
      setPreferences(prefs);
      preferencesRef.current = prefs;
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem('paperleaf:active');
      } catch {
        /* Optional browser hint. */
      }
      const selected = new URLSearchParams(window.location.search).get('paper') || remembered;
      const initial = list.find((paper) => paper.id === selected) || list[0];
      if (initial) await openPaper(initial.id);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '初始化失败');
    } finally {
      setLoading(false);
    }
  }, [notify, openPaper]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const open = () => openSettings('ai');
    window.addEventListener('paperleaf:open-settings', open);
    window.addEventListener('paperleaf:search', focusSearch);
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('paperleaf:open-settings', open);
      window.removeEventListener('paperleaf:search', focusSearch);
      window.removeEventListener('keydown', keyboard);
    };
  }, [openSettings, focusSearch]);
  const detailId = detail?.id;
  const reportStatus = detail?.report?.status;
  useEffect(() => {
    if (!detailId || reportStatus !== 'running') return;
    const source = new EventSource(`/api/ai/report/${detailId}`);
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as ReportEvent;
        if (payload.type === 'snapshot') {
          setDetail((current) =>
            current?.id === detailId ? { ...current, report: payload.report } : current,
          );
          setPapers((list) =>
            list.map((paper) =>
              paper.id === detailId ? { ...paper, report: payload.report } : paper,
            ),
          );
        }
        if (payload.type === 'error') notify(payload.message);
        if (payload.type === 'done') source.close();
      } catch {
        notify('报告数据暂时无法读取，请刷新重连');
        source.close();
      }
    };
    // EventSource reconnects automatically; completed sections are durable in SQLite.
    return () => source.close();
  }, [detailId, reportStatus, notify]);
  useEffect(() => {
    if (!papers.some((paper) => paper.report?.status === 'running')) return;
    const timer = setInterval(() => {
      void api<Paper[]>('/api/papers')
        .then(setPapers)
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [papers]);
  const onPage = useCallback(
    (page: number, position = 0) => {
      const id = activeId.current;
      if (!id) return;
      latestPage.current = { id, page, position };
      setDetail((current) =>
        current?.id === id ? { ...current, lastPage: page, lastPosition: position } : current,
      );
      setPapers((list) =>
        list.map((paper) => (paper.id === id ? { ...paper, lastPage: page } : paper)),
      );
      try {
        localStorage.setItem(`paperleaf:page:${id}`, String(page));
      } catch {
        /* Server persistence still works. */
      }
      if (pageTimer.current) clearTimeout(pageTimer.current);
      pageTimer.current = setTimeout(() => {
        pageQueue.current = pageQueue.current
          .then(async () => {
            await api(`/api/papers/${id}`, {
              method: 'PATCH',
              body: JSON.stringify({ lastPage: page, lastPosition: position }),
            });
          })
          .catch((cause: unknown) =>
            notify(cause instanceof Error ? cause.message : '阅读位置保存失败'),
          );
      }, 400);
    },
    [notify],
  );
  useEffect(() => {
    const flush = () => {
      const current = latestPage.current;
      if (current)
        void fetch(`/api/papers/${current.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastPage: current.page, lastPosition: current.position }),
          keepalive: true,
        }).catch(() => undefined);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);
  async function upload(files: FileList | File[]) {
    if (uploading.current) return;
    const list = Array.from(files);
    if (!list.length) return;
    if (list.length > (settings?.maxUploadFiles || 10)) {
      notify(`一次最多导入 ${settings?.maxUploadFiles || 10} 个 PDF`);
      return;
    }
    uploading.current = true;
    const targetShelf = activeShelfRef.current;
    let success = 0;
    const failures: string[] = [];
    let firstId: string | null = null;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setUploadMessage(`导入 ${i + 1}/${list.length}`);
      try {
        if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('仅支持 PDF');
        if (file.size > (settings?.maxUploadMB || 50) * 1024 * 1024)
          throw new Error(`文件超过 ${settings?.maxUploadMB || 50} MiB`);
        const form = new FormData();
        form.append('file', file);
        const paper = await api<Paper>(
          `/api/papers${targetShelf ? `?shelfId=${encodeURIComponent(targetShelf)}` : ''}`,
          { method: 'POST', body: form },
        );
        setPapers((current) => [paper, ...current]);
        firstId ??= paper.id;
        success++;
        if (success === 1) await openPaper(paper.id);
      } catch (cause) {
        failures.push(`${file.name}：${cause instanceof Error ? cause.message : '导入失败'}`);
      }
    }
    uploading.current = false;
    setUploadMessage('');
    if (inputRef.current) inputRef.current.value = '';
    if (firstId && activeId.current !== firstId) await openPaper(firstId);
    notify(
      failures.length
        ? `已导入 ${success} 篇。${failures.join('；')}`
        : `已导入 ${success} 篇文献${settings?.aiEnabled && preferencesRef.current.autoInterpret ? '，正在自动解读' : settings?.aiEnabled ? '，可阅读或手动生成报告' : '，可开始阅读；AI 尚未配置'}`,
      !failures.length,
    );
  }
  async function generate(force: boolean) {
    if (!detail) return;
    if (!settings?.aiEnabled) {
      notify('未配置 AI，请填写 API 地址、Key 和模型名称');
      openSettings('ai');
      return;
    }
    const id = detail.id;
    setGenerating(true);
    try {
      await api(`/api/ai/report/${id}`, { method: 'POST', body: JSON.stringify({ force }) });
      const fresh = await api<PaperDetail>(`/api/papers/${id}`);
      if (activeId.current === id) setDetail(fresh);
      setPapers((list) => list.map((paper) => (paper.id === id ? fresh : paper)));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '解读启动失败');
    } finally {
      setGenerating(false);
    }
  }
  const jumpTo = useCallback((page: number, quote: string, anchor?: ReadingAnchor | null) => {
    setView('original');
    setJump({ page, quote, anchor, nonce: Date.now() });
  }, []);
  function evidence(point: EvidencePoint) {
    if (point.page) jumpTo(point.page, point.quote);
  }
  async function ask(
    action: AiAction,
    context: SelectionContext | null,
    question = '',
    selectedSlot = aiSlot,
  ) {
    setPanel(true);
    setPanelTab('chat');
    if (!detail || askBusy) return false;
    if (!(
      settings?.aiProfiles?.find((item) => item.slot === selectedSlot)?.enabled ??
      (selectedSlot === 1 && settings?.aiEnabled)
    )) {
      notify('未配置 AI：阅读和笔记仍可使用，请在设置中查看配置说明');
      return false;
    }
    if (action === 'question' && !question) return false;
    const id = detail.id;
    let linkedPaperIds = linkEnabled ? linkedIds : [];
    if (linkEnabled && action === 'question') {
      const matched = matchLinkedPapers(question, papers, id, shelves);
      if (matched.ambiguous) {
        notify('书架中有同名文献，请在标题前写明所属书架');
        return false;
      }
      if (matched.shelfMismatch) {
        notify('指定书架中没有匹配的文献，请检查书架名称和完整标题');
        return false;
      }
      if (matched.shelfMentioned && !matched.ids.length) {
        const fromMentionedShelves = linkedIds.filter((linkedId) => {
          const linkedPaper = papers.find((item) => item.id === linkedId);
          return linkedPaper && matched.mentionedShelfIds.includes(linkedPaper.shelfId || null);
        });
        if (!fromMentionedShelves.length) {
          notify('请在问题中输入要联动文献的完整标题');
          return false;
        }
        linkedPaperIds = fromMentionedShelves;
        setLinkedIds(fromMentionedShelves);
      }
      if (matched.ids.length > 8) {
        notify('一次最多联动 8 篇文献，请减少问题中提到的文献');
        return false;
      }
      if (matched.ids.length) {
        linkedPaperIds = matched.ids;
        setLinkedIds(matched.ids);
      }
    }
    setAskBusy(true);
    try {
      const item = await api<AiHistory>(`/api/ai/ask/${id}`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          question,
          selectedText: context?.text || '',
          anchor: context?.anchor,
          page: context?.page || detail.lastPage,
          aiSlot: selectedSlot,
          linkedPaperIds,
        }),
      });
      setDetail((current) =>
        current?.id === id ? { ...current, history: [...current.history, item] } : current,
      );
      return true;
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '追问失败');
      return false;
    } finally {
      setAskBusy(false);
    }
  }
  async function addNote(
    content = '',
    selectedText = '',
    source: Note['source'] = 'manual',
    page?: number,
    anchor?: ReadingAnchor | null,
  ) {
    if (!detail) return;
    const id = detail.id;
    try {
      const note = await api<Note>(`/api/papers/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({
          content,
          selectedText,
          source,
          page: page || detail.lastPage,
          anchor: anchor || {
            version: 1,
            locations: [
              { page: page || detail.lastPage, rects: [], position: detail.lastPosition || 0 },
            ],
          },
        }),
      });
      setDetail((current) =>
        current?.id === id ? { ...current, notes: [note, ...current.notes] } : current,
      );
      setActiveNoteId(note.id);
      setPanel(true);
      setPanelTab('notes');
      if (source !== 'manual') notify('已保存为笔记', true);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '笔记创建失败');
    }
  }
  const noteSaved = useCallback(
    (note: Note) =>
      setDetail((current) =>
        current?.id === note.paperId
          ? { ...current, notes: current.notes.map((item) => (item.id === note.id ? note : item)) }
          : current,
      ),
    [],
  );
  const deleteNote = useCallback(async (id: string) => {
    const paperId = activeId.current;
    if (!paperId) return;
    await api(`/api/papers/${paperId}/notes/${id}`, { method: 'DELETE' });
    setActiveNoteId((current) => (current === id ? null : current));
    setJump(null);
    window.getSelection()?.removeAllRanges();
    setDetail((current) =>
      current?.id === paperId
        ? { ...current, notes: current.notes.filter((note) => note.id !== id) }
        : current,
    );
  }, []);
  return (
    <>
      {settings?.desktopMode && (
        <DesktopTitlebar
          onSettings={openSettings}
          onNewShelf={() => {
            setShelfHidden(false);
            setCreateShelfSignal((value) => value + 1);
          }}
          onToggleShelf={() => {
            if (window.innerWidth <= 1100) setMobileShelf((value) => !value);
            else setShelfHidden((value) => !value);
          }}
          onSearch={focusSearch}
          onError={onError}
        />
      )}
      <div
        className={`workspace ${settings?.desktopMode ? 'desktop-workspace' : ''} ${shelfHidden ? 'shelf-hidden' : ''} ${preferences.reduceMotion ? 'reduced-motion' : ''}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="sr-only"
          aria-label="上传 PDF 文件"
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files);
          }}
        />
        <ProjectShelf
          shelves={shelves}
          setShelves={setShelves}
          activeShelfId={activeShelfId}
          onShelfSelect={selectShelf}
          defaultCollapsed={preferences.defaultShelfCollapsed}
          onDefaultCollapse={(value) => changePreferences({ defaultShelfCollapsed: value })}
          createSignal={createShelfSignal}
          onError={onError}
          onMove={async (paper, shelfId) => {
            const moved = await api<Paper>(`/api/papers/${paper.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ shelfId }),
            });
            setPapers((items) => items.map((item) => (item.id === moved.id ? moved : item)));
            setDetail((current) => (current?.id === moved.id ? { ...current, ...moved } : current));
            selectShelf(shelfId);
          }}
          onShelfDeleted={(id) => {
            setPapers((items) =>
              items.map((paper) => (paper.shelfId === id ? { ...paper, shelfId: null } : paper)),
            );
            setDetail((current) =>
              current?.shelfId === id ? { ...current, shelfId: null } : current,
            );
            if (activeShelfRef.current === id) selectShelf(null);
          }}
          papers={papers}
          activeId={detail?.id || null}
          onSelect={(id) => {
            if (detail?.id !== id) void openPaper(id);
          }}
          onUpload={() => inputRef.current?.click()}
          uploadMessage={uploadMessage}
          onRename={(paper) => {
            setEditing(paper);
            setNewTitle(paper.title);
          }}
          onDelete={setDeleting}
          onSettings={() => openSettings()}
          open={mobileShelf}
          onClose={() => setMobileShelf(false)}
          settings={settings}
        />
        <main className="main-workspace">
          <header className="workspace-header">
            <div className="breadcrumb">
              <button
                className="mobile-menu"
                onClick={() => setMobileShelf(true)}
                aria-label="打开书架"
              >
                <Menu size={19} />
              </button>
              <span>
                {shelves.find((shelf) => shelf.id === (detail ? detail.shelfId : activeShelfId))
                  ?.name || '我的书架'}
              </span>
              <ChevronRight size={13} />
              <strong>{detail?.title || '阅读空间'}</strong>
            </div>
            <div className="header-actions">
              <span className="local-indicator">
                <span />
                本地空间
              </span>
              {detail && (
                <>
                  <Button
                    variant={panel ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setPanel(!panel)}
                    aria-label={panel ? '收起侧边面板' : '打开追问面板'}
                  >
                    {panel ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
                    <span className="panel-toggle-label">追问与笔记</span>
                  </Button>
                </>
              )}
            </div>
          </header>
          {settings?.aiEnabled && preferences.showAiNotice && (
            <div className="auto-privacy">
              <ShieldCheck size={12} />
              <span>
                AI 已启用：
                {preferences.autoInterpret ? '新导入文献会自动解读' : '新导入文献可手动解读'}
                ，内容发送至 {settings.aiHost}
                {settings.aiVisionEnabled ? '（包含页面图像）' : ''}。
              </span>
              <button onClick={() => openSettings('privacy')}>配置与隐私</button>
              <button
                className="ai-notice-close"
                aria-label="关闭 AI 使用提示"
                title="仅隐藏提示，不关闭 AI"
                onClick={() => changePreferences({ showAiNotice: false })}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {loading || loadingPaper ? (
            <div className="workspace-loading">
              <LoaderCircle size={25} className="spin" />
              <p>{loading ? '正在打开你的阅读空间…' : '正在打开文献…'}</p>
            </div>
          ) : detail ? (
            <>
              <div className="document-tabs">
                <div role="tablist" aria-label="文献视图">
                  <button
                    role="tab"
                    aria-selected={view === 'report'}
                    className={view === 'report' ? 'active' : ''}
                    onClick={() => setView('report')}
                  >
                    <Sparkles size={16} />
                    解读报告
                    {detail.report?.status === 'running' && <span className="tab-running" />}
                  </button>
                  <button
                    role="tab"
                    aria-selected={view === 'original'}
                    className={view === 'original' ? 'active' : ''}
                    onClick={() => setView('original')}
                  >
                    <BookOpen size={16} />
                    原文<span className="tab-page-count">{detail.pageCount} 页</span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={view === 'citation'}
                    className={view === 'citation' ? 'active' : ''}
                    onClick={() => setView('citation')}
                  >
                    <FileText size={16} />
                    文献引用
                  </button>
                </div>
                <span className="document-file-info">
                  <FileText size={13} />
                  PDF<span>·</span>
                  {fileSize(detail.fileSize)}
                </span>
              </div>
              <div className="reading-layout">
                <div className="reading-main">
                  {view === 'report' ? (
                    <ReportView
                      paper={detail}
                      settings={settings}
                      onGenerate={(force) => void generate(force)}
                      generating={generating}
                      onEvidence={evidence}
                      onOriginal={() => setView('original')}
                      onSettings={() => openSettings('ai')}
                    />
                  ) : view === 'citation' ? (
                    <CitationView key={detail.id} paper={detail} />
                  ) : (
                    <PdfReader
                      key={detail.id}
                      paperId={detail.id}
                      initialPage={detail.lastPage}
                      initialPosition={detail.lastPosition}
                      initialFit={preferences.readerFitWidth}
                      notes={detail.notes}
                      activeNoteId={activeNoteId}
                      onNoteActivate={(id) => {
                        setActiveNoteId(id);
                        setPanel(true);
                        setPanelTab('notes');
                      }}
                      onNoteCreate={(context) => {
                        void addNote('', context.text, 'manual', context.page, context.anchor);
                      }}
                      jump={jump}
                      onPage={onPage}
                      onAsk={(action, context) => {
                        setSelection(context);
                        void ask(action, context);
                      }}
                      onSelection={setSelection}
                      onError={onError}
                    />
                  )}
                </div>
                {panel && (
                  <SidePanel
                    key={detail.id}
                    paper={detail}
                    aiSlot={aiSlot}
                    onAiSlot={setAiSlot}
                    linkEnabled={linkEnabled}
                    onLinkEnabled={(enabled) => {
                      setLinkEnabled(enabled);
                      if (!enabled) setLinkedIds([]);
                    }}
                    settings={settings}
                    selection={selection}
                    page={detail.lastPage}
                    activeNoteId={activeNoteId}
                    busy={askBusy}
                    tab={panelTab}
                    onTab={setPanelTab}
                    onClose={() => setPanel(false)}
                    onQuestion={(question, slot) => ask('question', selection, question, slot)}
                    onSaveAnswer={async (item, withExcerpt) => {
                      await addNote(
                        item.answer,
                        item.selectedText,
                        withExcerpt ? 'excerpt' : 'ai',
                        item.page,
                        item.anchor,
                      );
                    }}
                    onAddNote={async () => {
                      await addNote();
                    }}
                    onNoteSaved={noteSaved}
                    onDeleteNote={deleteNote}
                    onJump={jumpTo}
                    onClearSelection={() => {
                      setSelection(null);
                      setJump(null);
                      window.getSelection()?.removeAllRanges();
                    }}
                    onError={onError}
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState
              autoInterpret={preferences.autoInterpret}
              settings={settings}
              onUpload={() => inputRef.current?.click()}
              onSettings={() => openSettings('ai')}
              onReload={() => void load()}
            />
          )}
        </main>
        {dragging && (
          <div className="drop-overlay">
            <div>
              <CloudUpload size={45} strokeWidth={1.2} />
              <h2>把文献放在这里</h2>
              <p>松开即可导入 PDF · 每个文件最多 {settings?.maxUploadMB || 50} MiB</p>
            </div>
          </div>
        )}
        {toast && (
          <div
            className={`toast ${toast.success ? 'success' : ''}`}
            role={toast.success ? 'status' : 'alert'}
          >
            {toast.success ? <CheckCircle2 size={18} /> : <MessageCircle size={18} />}
            <span>{toast.message}</span>
            <button aria-label="关闭提示" onClick={() => setToast(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        <SettingsWindow
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialSection={settingsSection}
          settings={settings}
          onAiSaved={setSettings}
          preferences={preferences}
          onPreferences={changePreferences}
          papers={papers}
          onUpload={() => inputRef.current?.click()}
          onError={onError}
        />
        <Dialog
          open={Boolean(editing)}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          title="重命名文献"
          description="只修改书架上的标题，保留原始文件名。"
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!editing) return;
              setMutating(true);
              try {
                const result = await api<Paper>(`/api/papers/${editing.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ title: newTitle }),
                });
                setPapers((list) => list.map((paper) => (paper.id === result.id ? result : paper)));
                setDetail((current) =>
                  current?.id === result.id ? { ...current, title: result.title } : current,
                );
                setEditing(null);
              } catch (cause) {
                notify(cause instanceof Error ? cause.message : '重命名失败');
              } finally {
                setMutating(false);
              }
            }}
          >
            <label className="field-label" htmlFor="paper-title">
              文献标题
            </label>
            <input
              className="text-input"
              id="paper-title"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              required
              maxLength={500}
            />
            <div className="dialog-actions">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button disabled={mutating || !newTitle.trim()} type="submit">
                保存标题
              </Button>
            </div>
          </form>
        </Dialog>
        <Dialog
          open={Boolean(deleting)}
          onOpenChange={(open) => {
            if (!open && !mutating) setDeleting(null);
          }}
          title="删除这篇文献？"
          description={`将同时删除「${deleting?.title || ''}」的本地 PDF、报告、追问记录和笔记。此操作无法撤销。`}
        >
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={mutating}>
              保留文献
            </Button>
            <Button
              variant="destructive"
              disabled={mutating}
              onClick={async () => {
                if (!deleting) return;
                setMutating(true);
                try {
                  const result = await api<{ pendingFileDeletion: boolean }>(
                    `/api/papers/${deleting.id}`,
                    { method: 'DELETE' },
                  );
                  const rest = papers.filter((paper) => paper.id !== deleting.id);
                  setPapers(rest);
                  if (detail?.id === deleting.id) {
                    activeId.current = null;
                    latestPage.current = null;
                    setDetail(null);
                    if (rest[0]) await openPaper(rest[0].id);
                    else window.history.replaceState(null, '', '/');
                  }
                  setDeleting(null);
                  notify(
                    result.pendingFileDeletion
                      ? '关联数据已删除；本地文件暂时被占用，下次打开书架将重试清理'
                      : '文献与关联数据已删除',
                    !result.pendingFileDeletion,
                  );
                } catch (cause) {
                  notify(cause instanceof Error ? cause.message : '删除失败');
                } finally {
                  setMutating(false);
                }
              }}
            >
              {mutating ? '正在删除…' : '删除文献'}
            </Button>
          </div>
        </Dialog>
      </div>
    </>
  );
}
function EmptyState({
  settings,
  onUpload,
  onSettings,
  onReload,
  autoInterpret,
}: {
  autoInterpret: boolean;
  settings: AppSettings | null;
  onUpload: () => void;
  onSettings: () => void;
  onReload: () => void;
}) {
  return (
    <div className="empty-workspace">
      <div className="empty-editorial">
        <div className="eyebrow">
          <span className="tiny-line" />
          你的私人阅读空间
        </div>
        <h1>
          先读懂，
          <br />
          <em>再深入。</em>
        </h1>
        <p className="empty-lead">
          让每一篇论文，都有清晰的来路。
          <br />
          从一份解读开始，带着问题回到原文。
        </p>
        <div className="empty-benefits">
          <span>
            <Sparkles size={15} />
            十个角度，读懂全篇
          </span>
          <span>
            <BookOpen size={15} />
            循着依据，回到原文
          </span>
          <span>
            <FilePenLine size={15} />
            记录思考，留在本机
          </span>
        </div>
        <div className="empty-leaf">
          <Leaf size={165} strokeWidth={0.6} />
        </div>
      </div>
      <div className="empty-upload-column">
        <button className="upload-dropzone" onClick={onUpload}>
          <span className="upload-illustration">
            <FileText size={40} strokeWidth={1.1} />
            <span>
              <Upload size={15} />
            </span>
          </span>
          <strong>放入你的第一篇文献</strong>
          <span>拖拽 PDF 到这里，或点击选择文件</span>
          <span className="upload-cta">
            选择 PDF <ArrowRight size={16} />
          </span>
          <small>支持多文件 · 每份最多 {settings?.maxUploadMB || 50} MiB</small>
        </button>
        <div className="empty-privacy">
          <ShieldCheck size={16} />
          <p>
            {settings?.aiEnabled
              ? `AI 已配置。${autoInterpret ? '导入后自动解读' : '可手动开始解读'}，内容发送至 ${settings.aiHost}；报告页可查看用量与进度。`
              : '文件与笔记只保存在本机。配置 AI 后，可自动生成整篇解读，也能在原文中划词追问。'}
          </p>
        </div>
        <button className="empty-config-link" onClick={settings ? onSettings : onReload}>
          {settings
            ? settings.aiEnabled
              ? '查看 AI 配置与隐私说明'
              : '配置 AI，开启文献解读'
            : '连接失败？重新连接本机服务'}
          <ArrowRight size={13} />
        </button>
      </div>
      <footer className="empty-bottom">
        <span>少一点信息负担，多一点真正理解。</span>
        <span>PAPERLEAF · A QUIETER WAY TO READ</span>
      </footer>
    </div>
  );
}
