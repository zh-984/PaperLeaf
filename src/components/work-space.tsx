'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Copy,
  FileText,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { defaultPreferences, type AppPreferences, type AppSettings } from '@/lib/types';
import {
  mergeRanges,
  type WorkDocument,
  type WorkFinding,
  type LocalDetectorState,
} from '@/lib/work';
import { fileSize, dateLabel } from '@/lib/utils';
import { ModeBrand } from './mode-brand';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { SettingsWindow } from './settings-window';
import { DesktopTitlebar } from './desktop-titlebar';
import { desktopAction } from '@/lib/desktop';
import { WorkDetectorSettings } from './work-detector-settings';
import { WorkLocalDetector } from './work-local-detector';
import { UpdateBadge } from './app-updates';
import { WorkHistory, workHistoryLabel } from './work-history';
import { ScientificText } from './scientific-text';
import type { WorkTask } from '@/lib/work';

type Summary = Pick<WorkDocument, 'id' | 'title' | 'fileName' | 'fileSize' | 'createdAt'>;
const labels = { high: '重点核对', medium: '建议检查', low: '低表达风险', unknown: '信息不足' };
function Highlight({ text, ranges }: { text: string; ranges: { start: number; end: number }[] }) {
  const merged = mergeRanges(ranges);
  let offset = 0;
  const parts: React.ReactNode[] = [];
  for (const [index, range] of merged.entries()) {
    parts.push(
      text.slice(offset, range.start),
      <mark key={index}>{text.slice(range.start, range.end)}</mark>,
    );
    offset = range.end;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}
export function WorkSpace({
  onModeChange,
  active = true,
  onReady,
}: {
  onModeChange: (mode: 'read' | 'work') => void;
  active?: boolean;
  onReady?: () => void;
}) {
  const initialized = useRef(false);
  const [items, setItems] = useState<Summary[]>([]),
    [doc, setDoc] = useState<WorkDocument | null>(null),
    [activeId, setActiveId] = useState('');
  const activeRef = useRef(''),
    revision = useRef(0),
    input = useRef<HTMLInputElement>(null),
    searchRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null),
    [preferences, setPreferences] = useState(defaultPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [settingsSection, setSettingsSection] = useState('ai');
  const [kind, setKind] = useState<'aigc' | 'similarity'>('aigc'),
    [slot, setSlot] = useState(1),
    [engine, setEngine] = useState<'assistant' | 'detector' | 'local'>('assistant');
  const [local, setLocal] = useState<LocalDetectorState | null>(null);
  const [detector, setDetector] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''),
    [sourceUrl, setSourceUrl] = useState(''),
    [discover, setDiscover] = useState(true),
    [excludeReferences, setExcludeReferences] = useState(true),
    [filter, setFilter] = useState('');
  const [pickedTask, setPickedTask] = useState(''),
    [selectedParagraph, setSelectedParagraph] = useState(''),
    [deleting, setDeleting] = useState(false),
    [renaming, setRenaming] = useState(false),
    [newTitle, setNewTitle] = useState('');
  const [deleteHistory, setDeleteHistory] = useState<WorkTask | null>(null);
  const [reportDetails, setReportDetails] = useState<'sources' | 'scope' | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false),
    [dragging, setDragging] = useState(false),
    [sidebar, setSidebar] = useState(true);
  const loadDoc = useCallback(async (id: string) => {
    const current = ++revision.current;
    const detail = await api<WorkDocument>(`/api/work/${id}`);
    if (activeRef.current === id && current === revision.current) setDoc(detail);
    return detail;
  }, []);
  const invalidateLoad = useCallback(() => {
    revision.current++;
  }, []);
  const select = useCallback(
    async (id: string) => {
      activeRef.current = id;
      setActiveId(id);
      setDoc(null);
      setPickedTask('');
      setSelectedParagraph('');
      setError('');
      localStorage.setItem('paperleaf-work-active', id);
      void api('/api/work/state', {
        method: 'PATCH',
        body: JSON.stringify({ documentId: id }),
        keepalive: true,
      }).catch(() => setError('上次稿件记忆未保存，可稍后重试'));
      try {
        const detail = await loadDoc(id);
        if (activeRef.current === id) {
          setQuery(detail.title.slice(0, 250));
          const previousEngine = detail.tasks.find((t) => t.kind === 'aigc')?.results.engine;
          if (previousEngine === 'assistant' || previousEngine === 'local')
            setEngine(previousEngine);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '读取失败');
      }
    },
    [loadDoc],
  );
  useEffect(() => {
    let live = true;
    Promise.all([
      api<Summary[]>('/api/work'),
      api<AppSettings>('/api/settings'),
      api<AppPreferences>('/api/preferences'),
      api<{ detector: boolean; local: LocalDetectorState }>('/api/work/capabilities'),
      api<{ documentId: string }>('/api/work/state'),
    ])
      .then(async ([list, config, prefs, capabilities, workState]) => {
        if (!live) return;
        setItems(list);
        setSettings(config);
        setPreferences(prefs);
        setDetector(capabilities.detector);
        setLocal(capabilities.local);
        if (!initialized.current && capabilities.local.ready) setEngine('local');
        const remembered = workState.documentId || localStorage.getItem('paperleaf-work-active');
        const first = list.find((item) => item.id === remembered) || list[0];
        if (first) {
          if (initialized.current && first.id === activeRef.current) await loadDoc(first.id);
          else await select(first.id);
        }
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : '加载失败');
      })
      .finally(() => {
        initialized.current = true;
        if (live) {
          setLoading(false);
          onReady?.();
        }
      });
    return () => {
      live = false;
      invalidateLoad();
    };
  }, [select, loadDoc, onReady, invalidateLoad]);
  const running = doc?.tasks.find((task) => task.status === 'running');
  useEffect(() => {
    if (!running || !activeId) return;
    const timer = setInterval(() => {
      void loadDoc(activeId).catch(() => setError('读取任务进度失败，可刷新重试'));
    }, 1400);
    return () => clearInterval(timer);
  }, [activeId, running, loadDoc]);
  useEffect(() => {
    if (!active || loading || !settings) return;
    if (document.documentElement.dataset.theme === preferences.theme) return;
    document.documentElement.dataset.theme = preferences.theme;
    if (settings?.desktopMode)
      void desktopAction(`theme:${preferences.theme}`).catch(() => undefined);
  }, [active, loading, preferences.theme, settings]);
  useEffect(() => {
    if (!active) return;
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        input.current?.click();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [active]);
  async function upload(files: FileList | File[] | null) {
    if (!files || uploading) return;
    setUploading(true);
    setError('');
    let imported = 0;
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        if (!/\.(pdf|docx)$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
          setError('仅支持 20 MiB 内的 DOCX、PDF；DOC 请先另存为 DOCX');
          continue;
        }
        const form = new FormData();
        form.set('file', file);
        try {
          const item = await api<Summary>('/api/work', { method: 'POST', body: form });
          setItems((current) => [item, ...current.filter((p) => p.id !== item.id)]);
          await select(item.id);
          imported++;
        } catch (cause) {
          setError(`${file.name}：${cause instanceof Error ? cause.message : '导入失败'}`);
        }
      }
      setNotice(`已导入 ${imported} 篇稿件；不会自动发送正文或开始检查`);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  async function start(force = false) {
    if (!doc) return;
    await action(async () => {
      await api(`/api/work/${doc.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          kind,
          aiSlot: slot,
          engine,
          excludeReferences,
          discover,
          query,
          force,
        }),
      });
      setPickedTask('');
      await loadDoc(doc.id);
    });
  }
  function jump(id: string) {
    setSelectedParagraph(id);
    document.getElementById(`work-${id}`)?.scrollIntoView({
      behavior: preferences.reduceMotion ? 'instant' : 'smooth',
      block: 'center',
    });
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('已复制，可在 Word 中修改');
    } catch {
      setError('无法访问剪贴板，请选中文字手动复制');
    }
  }
  const task =
    doc?.tasks.find((task) => task.id === pickedTask && task.kind === kind) ||
    doc?.tasks.find((task) => task.kind === kind);
  const config = settings?.aiProfiles?.find((profile) => profile.slot === slot);
  const findings = task?.results.findings || [];
  const matches = task?.results.matches || [];
  const focus =
    selectedParagraph ||
    findings.find((f) => f.risk === 'high' || f.risk === 'medium')?.paragraphId ||
    matches[0]?.paragraphId ||
    '';
  const finding = findings.find((f) => f.paragraphId === focus);
  const openSettings = (section = 'ai') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  const enableLocal = useCallback(() => setEngine('local'), []);
  return (
    <>
      {settings?.desktopMode && (
        <DesktopTitlebar
          onSettings={openSettings}
          onNewShelf={() => input.current?.click()}
          onToggleShelf={() => setSidebar(!sidebar)}
          onSearch={() => searchRef.current?.focus()}
          onError={setError}
        />
      )}
      <div
        className={`work-space ${settings?.desktopMode ? 'desktop-workspace' : ''} ${!sidebar ? 'work-sidebar-hidden' : ''}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
      >
        <input
          ref={input}
          className="sr-only"
          type="file"
          multiple
          accept=".pdf,.docx"
          aria-label="上传 Work 稿件"
          onChange={(event) => void upload(event.target.files)}
        />
        <aside className="work-shelf">
          <ModeBrand mode="work" onChange={onModeChange} />
          <Button
            className="shelf-upload"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            {uploading ? <LoaderCircle size={17} className="spin" /> : <Plus size={18} />}{' '}
            {uploading ? '正在提取稿件…' : '导入稿件'}
          </Button>
          <span className="upload-destination">DOCX / PDF · 每份最多 20 MiB</span>
          <label className="shelf-search">
            <Search size={15} />
            <input
              ref={searchRef}
              aria-label="搜索 Work 稿件"
              placeholder="搜索稿件"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <nav aria-label="Work 稿件列表" className="work-document-list">
            {items
              .filter((item) =>
                (item.title + ' ' + item.fileName).toLowerCase().includes(filter.toLowerCase()),
              )
              .map((item) => (
                <button
                  key={item.id}
                  aria-current={activeId === item.id ? 'page' : undefined}
                  className={activeId === item.id ? 'active' : ''}
                  onClick={() => void select(item.id)}
                >
                  <FileText size={17} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {dateLabel(item.createdAt)} · {fileSize(item.fileSize)}
                    </small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))}
            {!items.length && !loading && (
              <p className="work-small">导入稿件后，在这里继续检查。</p>
            )}
          </nav>
          <div className="shelf-footer work-shelf-footer">
            <div className="local-badge">
              <ShieldCheck size={16} />
              <span>
                稿件和报告保存在本机
                <small>检查由你手动开始</small>
              </span>
            </div>
            <div className="settings-update-row">
              <button className="settings-button" onClick={() => openSettings()}>
                <Settings2 size={16} /> 设置与隐私
                <ChevronRight size={14} />
              </button>
              <UpdateBadge />
            </div>
          </div>
        </aside>
        <main className="work-main">
          <header className="work-header">
            <div>
              {!doc && <span className="eyebrow">PAPERLEAF WORK</span>}
              <h1 title={doc?.title}>
                {doc ? <ScientificText text={doc.title} /> : '把问题看清，再动笔修改。'}
              </h1>
              {doc && (
                <small title={doc.fileName}>
                  {doc.fileName.toLowerCase().endsWith('.pdf') ? 'PDF' : 'Word'} ·{' '}
                  {doc.paragraphs.length} 段 · {fileSize(doc.fileSize)}
                </small>
              )}
            </div>
            <div>
              {doc && (
                <>
                  <button
                    title="重命名稿件"
                    onClick={() => {
                      setNewTitle(doc.title);
                      setError('');
                      setRenaming(true);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    title="删除稿件"
                    aria-label="删除 Work 稿件"
                    onClick={() => {
                      setError('');
                      setDeleting(true);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
              <button onClick={() => openSettings()}>
                <Settings2 size={17} /> AI 配置
              </button>
            </div>
          </header>
          {error && (
            <div role="alert" className="work-alert">
              <span>{error}</span>
              <button aria-label="关闭错误提示" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="work-notice">
              <Check size={16} />
              <span>{notice}</span>
              <button aria-label="关闭 Work 提示" onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="work-empty">
              <LoaderCircle className="spin" />
              正在读取本地稿件…
            </div>
          ) : !doc ? (
            <div className="work-empty">
              <div className="work-empty-icon">
                <FileText size={42} />
              </div>
              <h2>先看清问题，再完善表达。</h2>
              <p>
                导入 Word 或 PDF，定位公开来源中的重复片段，
                <br />
                检查可疑表达，带着建议回到 Word。
              </p>
              <Button disabled={uploading} onClick={() => input.current?.click()}>
                <Upload size={17} /> 选择稿件
              </Button>
              <small>不自动检查 · 不订阅检测服务 · 不修改原稿</small>
            </div>
          ) : (
            <>
              <div role="tablist" aria-label="Work 检查类型" className="work-tabs">
                <button
                  role="tab"
                  aria-selected={kind === 'aigc'}
                  onClick={() => {
                    setKind('aigc');
                    setSelectedParagraph('');
                    setPickedTask('');
                  }}
                >
                  AIGC 分析
                </button>
                <button
                  role="tab"
                  aria-selected={kind === 'similarity'}
                  onClick={() => {
                    setKind('similarity');
                    setSelectedParagraph('');
                    setPickedTask('');
                  }}
                >
                  公开来源查重
                </button>
              </div>
              <section className="work-controls" aria-label="检查选项">
                <div className="work-control-row">
                  {kind === 'aigc' ? (
                    <>
                      <label>
                        检测方式
                        <select
                          value={engine}
                          disabled={!!running || busy}
                          onChange={(event) => setEngine(event.target.value as typeof engine)}
                        >
                          <option value="assistant">AI 辅助分析</option>
                          <option value="local">
                            本地中文专用检测{!local?.ready ? '（先下载模型）' : ''}
                          </option>
                          {detector && <option value="detector">外部专用检测器</option>}
                        </select>
                      </label>
                      {engine === 'assistant' && (
                        <label>
                          分析模型
                          <select
                            value={slot}
                            disabled={!!running || busy}
                            onChange={(event) => setSlot(Number(event.target.value))}
                          >
                            {(
                              settings?.aiProfiles || [
                                { slot: 1, model: settings?.aiModel || '未配置 AI' },
                              ]
                            ).map((profile) => (
                              <option key={profile.slot} value={profile.slot}>
                                {profile.model || '未配置 AI'}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </>
                  ) : (
                    <>
                      <label className="work-query">
                        公开检索词
                        <input
                          value={query}
                          maxLength={250}
                          placeholder="输入稿件主题或关键句"
                          disabled={!!running || busy}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </label>
                      <label className="work-check">
                        <input
                          type="checkbox"
                          checked={discover}
                          disabled={!!running || busy}
                          onChange={(event) => setDiscover(event.target.checked)}
                        />
                        检索开放论文
                      </label>
                      <button className="work-link" onClick={() => setSourcesOpen(!sourcesOpen)}>
                        {doc.sources.length} 个已取得来源 · 管理
                      </button>
                    </>
                  )}
                  <label className="work-check">
                    <input
                      type="checkbox"
                      checked={excludeReferences}
                      disabled={!!running || busy}
                      onChange={(event) => setExcludeReferences(event.target.checked)}
                    />
                    排除参考文献章节
                  </label>
                  <Button
                    disabled={
                      busy || !!running || (kind === 'aigc' && engine === 'local' && !local?.ready)
                    }
                    onClick={() => void start()}
                  >
                    {busy ? <LoaderCircle size={16} className="spin" /> : null}
                    {task?.results.failedParagraphs
                      ? '重试未完成段落'
                      : task?.status === 'failed' || task?.status === 'cancelled'
                        ? '继续检查'
                        : kind === 'aigc'
                          ? '开始分析'
                          : '开始查重'}
                  </Button>
                  {running?.kind === kind && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api(`/api/work/${doc.id}/tasks/${running.id}`, {
                            method: 'DELETE',
                          });
                          await loadDoc(doc.id);
                        })
                      }
                    >
                      取消
                    </Button>
                  )}
                  {task && !running && kind === 'aigc' && (
                    <button
                      disabled={busy}
                      className="work-link"
                      onClick={() => void start(true)}
                      title="重新调用模型，可能再次产生 API 费用"
                    >
                      重新分析
                    </button>
                  )}
                </div>
                <details className="work-options">
                  <summary>
                    说明与高级设置
                    {kind === 'aigc'
                      ? engine === 'assistant'
                        ? ` · 手动分析发送至 ${config?.host || settings?.aiHost || '所选服务'}`
                        : engine === 'local'
                          ? local?.ready
                            ? ' · 本地运行'
                            : ' · 点击下载本地模型'
                          : ' · 使用外部检测服务'
                      : ''}
                  </summary>
                  <p className="work-privacy">
                    {kind === 'aigc'
                      ? engine === 'assistant'
                        ? `手动开始后，正文分段发送至 ${config?.host || settings?.aiHost || '所选 API 服务'}。格式有误时最多补请求一次，仅补缺失段落，成功内容缓存。表达风险分析不证明作者身份。`
                        : engine === 'local'
                          ? '正文只在本机 CPU 推理，不发送到 AI 服务；整段评分仅供人工核对。'
                          : '手动开始后正文发送至你配置的专用检测器，结果仅供人工核对。'
                      : `仅将检索词或稿件标题发送至 Europe PMC / OpenAlex / arXiv，不发送稿件正文。${discover ? '自动简化检索词，读取最多 4 个新正文，支持 PDF 回退。' : '仅比对已经取得的来源。'}不覆盖全网或知网。`}
                  </p>
                  {kind === 'aigc' && (
                    <>
                      <WorkLocalDetector
                        state={local}
                        onChange={setLocal}
                        onError={setError}
                        onReady={enableLocal}
                      />
                      <WorkDetectorSettings
                        disabled={!!running || busy}
                        onError={setError}
                        onSaved={(enabled) => {
                          setDetector(enabled);
                          if (!enabled) setEngine('assistant');
                          setNotice('专用检测器配置已保存到本机');
                        }}
                      />
                    </>
                  )}
                </details>
                {kind === 'similarity' && sourcesOpen && (
                  <div className="work-sources">
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void action(async () => {
                          await api(`/api/work/${doc.id}/sources`, {
                            method: 'POST',
                            body: JSON.stringify({ url: sourceUrl }),
                          });
                          setSourceUrl('');
                          await loadDoc(doc.id);
                        });
                      }}
                    >
                      <label>
                        补充公开来源链接
                        <input
                          type="url"
                          value={sourceUrl}
                          maxLength={2000}
                          required
                          placeholder="https://…（公开网页 / 文本 / PDF）"
                          onChange={(event) => setSourceUrl(event.target.value)}
                        />
                      </label>
                      <Button variant="secondary" disabled={busy || !!running}>
                        读取来源
                      </Button>
                    </form>
                    <small>
                      只读取你提交的公开页面，不读取本机或内网。最多 12
                      个正文来源，不下载整库、不保存远端 PDF；单次读取最多 6 MiB，正文最多 15
                      万字符。失败的来源不计入重复率。
                    </small>
                    {doc.sources.map((source) => (
                      <div key={source.id}>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {source.title}
                        </a>
                        <small>{source.characters.toLocaleString()} 字符</small>
                        <button
                          disabled={!!running || busy}
                          aria-label={`删除来源 ${source.title}`}
                          onClick={() =>
                            void action(async () => {
                              await api(`/api/work/${doc.id}/sources/${source.id}`, {
                                method: 'DELETE',
                              });
                              await loadDoc(doc.id);
                            })
                          }
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="work-results-summary">
                <div>
                  {kind === 'similarity' ? (
                    <>
                      <strong>
                        {task?.results.percentage == null ? '—' : `${task.results.percentage}%`}
                      </strong>
                      <span>公开来源重复率 · {task?.results.comparedSources ?? 0} 个正文来源</span>
                    </>
                  ) : (
                    <>
                      <strong>
                        {findings.filter((f) => f.risk === 'high').length}
                        <small> 段</small>
                      </strong>
                      <span>
                        重点核对 · {findings.filter((f) => f.risk === 'medium').length} 段建议检查
                      </span>
                    </>
                  )}
                </div>
                <p aria-live="polite">
                  {task?.status === 'running' && <LoaderCircle size={15} className="spin" />}
                  {task?.progress ||
                    (running && running.kind !== kind
                      ? '另一项检查正在进行，本项尚未开始'
                      : '导入后不会自动开始检查')}
                  {task && (
                    <small>
                      {task.results.model || `${task.results.totalParagraphs ?? 0} 段正文`}
                    </small>
                  )}
                </p>
                <WorkHistory
                  tasks={doc.tasks.filter((item) => item.kind === kind)}
                  selected={task?.id}
                  onSelect={(id) => {
                    setPickedTask(id);
                    setSelectedParagraph('');
                  }}
                  onDelete={setDeleteHistory}
                />
              </section>
              {task?.error && <div className="work-alert">{task.error}</div>}
              {(!!task?.results.discovery || !!task?.results.warnings?.length) && (
                <div className="work-detail-links">
                  {kind === 'similarity' && task?.results.discovery && (
                    <button onClick={() => setReportDetails('sources')}>
                      来源详情 · {task.results.discovery.candidates} 个候选 ·{' '}
                      {task.results.comparedSources || 0} 个正文
                    </button>
                  )}
                  {!!task?.results.warnings?.length && (
                    <button onClick={() => setReportDetails('scope')}>报告说明</button>
                  )}
                </div>
              )}
              <div className="work-reading-grid">
                <article className="work-text" aria-label="稿件正文">
                  {doc.paragraphs.map((paragraph) => {
                    const risk = findings.find((f) => f.paragraphId === paragraph.id);
                    const ranges =
                      kind === 'aigc' && risk && (risk.risk === 'high' || risk.risk === 'medium')
                        ? [risk]
                        : kind === 'similarity'
                          ? matches.filter((m) => m.paragraphId === paragraph.id)
                          : [];
                    return (
                      <section
                        key={paragraph.id}
                        id={`work-${paragraph.id}`}
                        className={`work-paragraph ${focus === paragraph.id ? 'selected' : ''}`}
                        onClick={() => setSelectedParagraph(paragraph.id)}
                      >
                        <button
                          className="work-paragraph-anchor"
                          onClick={() => jump(paragraph.id)}
                        >
                          第 {paragraph.id.slice(1)} 段
                          {paragraph.page ? ` · p.${paragraph.page}` : ''} · {paragraph.heading}
                        </button>
                        <p>
                          <Highlight text={paragraph.text} ranges={ranges} />
                        </p>
                      </section>
                    );
                  })}
                </article>
                <aside className="work-findings" aria-label="问题定位与修改建议">
                  <h2>{kind === 'aigc' ? '位置与改进建议' : '重复来源与对应片段'}</h2>
                  {kind === 'aigc' ? (
                    <>
                      <div className="work-finding-list">
                        {findings.map((item) => (
                          <button
                            key={item.paragraphId}
                            className={focus === item.paragraphId ? 'active' : ''}
                            onClick={() => jump(item.paragraphId)}
                          >
                            <span className={`work-risk ${item.risk}`}>
                              {item.retryable ? '待重试' : labels[item.risk]}
                            </span>
                            <span>第 {item.paragraphId.slice(1)} 段</span>
                            {item.score !== undefined && (
                              <small>模型评分 {(item.score * 100).toFixed(1)}%</small>
                            )}
                          </button>
                        ))}
                      </div>
                      {finding ? (
                        <Finding finding={finding} onCopy={copy} />
                      ) : (
                        <p className="work-small">
                          {task?.status === 'complete'
                            ? '本次没有可展示的分析结果。'
                            : '开始检查后，结果会逐批出现在这里。点击正文或列表可定位。'}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      {matches.length ? (
                        <>
                          {matches
                            .filter((m) => m.paragraphId === focus)
                            .map((match, index) => (
                              <div className="work-source-match" key={index}>
                                <a href={match.url} target="_blank" rel="noreferrer">
                                  {match.sourceTitle} ↗
                                </a>
                                <blockquote>{match.sourceQuote.slice(0, 700)}</blockquote>
                                <button
                                  className="work-link"
                                  onClick={() => jump(match.paragraphId)}
                                >
                                  定位第 {match.paragraphId.slice(1)} 段
                                </button>
                                <p>检查是否属于规范引用；需要改写时保留事实并注明来源。</p>
                              </div>
                            ))}
                          <h3>命中位置</h3>
                          {[...new Set(matches.map((m) => m.paragraphId))].map((id) => (
                            <button className="work-match-jump" key={id} onClick={() => jump(id)}>
                              第 {id.slice(1)} 段 ·{' '}
                              {matches.filter((m) => m.paragraphId === id).length} 处匹配
                            </button>
                          ))}
                        </>
                      ) : (
                        <p className="work-small">
                          {task?.status === 'complete' && task.results.percentage != null
                            ? '在本次取得的来源中未发现达到阈值的连续文字匹配。这不代表全网无重复。'
                            : '取得公开正文后才能比对；没有来源时不显示 0%。'}
                        </p>
                      )}
                    </>
                  )}
                </aside>
              </div>
            </>
          )}
        </main>
        {dragging && (
          <div className="work-drop-overlay">
            <Upload size={42} />
            <h2>放入 DOCX 或 PDF 稿件</h2>
          </div>
        )}
        <SettingsWindow
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialSection={settingsSection}
          settings={settings}
          onAiSaved={setSettings}
          preferences={preferences}
          onPreferences={async (patch) => {
            try {
              setPreferences(
                await api<AppPreferences>('/api/preferences', {
                  method: 'PATCH',
                  body: JSON.stringify(patch),
                }),
              );
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '保存设置失败');
            }
          }}
          papers={[]}
          onUpload={() => input.current?.click()}
          onError={setError}
        />
        <Dialog
          open={!!deleteHistory}
          onOpenChange={(value) => {
            if (!value && !busy) setDeleteHistory(null);
          }}
          title="删除历史记录和报告？"
          description="将永久删除该次检查记录和对应报告。原稿、其他报告、公开来源及可复用缓存保留。"
        >
          <p className="work-history-delete-label">
            {deleteHistory && workHistoryLabel(deleteHistory)}
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" disabled={busy} onClick={() => setDeleteHistory(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (!doc || !deleteHistory) return;
                  await api('/api/work/' + doc.id + '/tasks/' + deleteHistory.id + '?remove=true', {
                    method: 'DELETE',
                  });
                  setPickedTask('');
                  setSelectedParagraph('');
                  setDeleteHistory(null);
                  await loadDoc(doc.id);
                })
              }
            >
              确认删除记录和报告
            </Button>
          </div>
        </Dialog>
        <Dialog
          open={!!reportDetails}
          onOpenChange={(value) => {
            if (!value) setReportDetails(null);
          }}
          title={reportDetails === 'sources' ? '来源检索详情' : '报告范围与说明'}
        >
          <div className="work-detail-dialog">
            {reportDetails === 'sources' && task?.results.discovery && (
              <>
                <p>实际检索词：{task.results.discovery.queries.join(' → ')}</p>
                {task.results.discovery.providers.map((provider) => (
                  <p key={provider.name}>
                    <strong>{provider.name}</strong> · {provider.message}
                  </p>
                ))}
                {task.results.discovery.failures.map((failure, i) => (
                  <p key={i}>
                    <a href={failure.url} target="_blank" rel="noreferrer">
                      {failure.title}
                    </a>
                    ：{failure.reason}
                  </p>
                ))}
                {!task.results.comparedSources && (
                  <p>尚无可比对正文。请缩短为主题词，或在来源管理补充公开全文链接。</p>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSourcesOpen(true);
                    setReportDetails(null);
                  }}
                >
                  打开来源管理
                </Button>
              </>
            )}
            {reportDetails === 'scope' &&
              task?.results.warnings?.map((warning, i) => <p key={i}>{warning}</p>)}
          </div>
        </Dialog>
        <Dialog
          open={deleting}
          onOpenChange={(value) => {
            if (!busy) setDeleting(value);
          }}
          title="删除稿件"
          description="将移除这份稿件的本地文件、检查报告、缓存和来源。"
          className="work-dialog"
        >
          <div className="work-dialog-document">
            <FileText size={20} />
            <p>{doc?.title}</p>
          </div>
          <p className="work-dialog-help">删除后无法撤销，其他稿件不会受影响。</p>
          {error && (
            <p role="alert" className="work-dialog-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" disabled={busy} onClick={() => setDeleting(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (!doc) return;
                  await api(`/api/work/${doc.id}`, { method: 'DELETE' });
                  const remaining = items.filter((item) => item.id !== doc.id);
                  setItems(remaining);
                  setDoc(null);
                  activeRef.current = '';
                  setActiveId('');
                  setDeleting(false);
                  if (remaining[0]) await select(remaining[0].id);
                })
              }
            >
              确认删除稿件
            </Button>
          </div>
        </Dialog>
        <Dialog
          open={renaming}
          onOpenChange={(value) => {
            if (!busy) setRenaming(value);
          }}
          title="重命名稿件"
          description="修改知页中显示的标题，原始文件名保持不变。"
          className="work-dialog"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !newTitle.trim()) return;
              void action(async () => {
                if (!doc) return;
                const title = newTitle.trim();
                await api(`/api/work/${doc.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ title }),
                });
                setItems((current) =>
                  current.map((item) => (item.id === doc.id ? { ...item, title } : item)),
                );
                await loadDoc(doc.id);
                setRenaming(false);
              });
            }}
          >
            <label className="field-label" htmlFor="work-rename-title">
              稿件标题
            </label>
            <input
              id="work-rename-title"
              className="text-input"
              value={newTitle}
              required
              disabled={busy}
              maxLength={300}
              onChange={(event) => setNewTitle(event.target.value)}
            />
            {error && (
              <p role="alert" className="work-dialog-error">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setRenaming(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy || !newTitle.trim()}>
                保存标题
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    </>
  );
}
function Finding({
  finding,
  onCopy,
}: {
  finding: WorkFinding;
  onCopy: (text: string) => Promise<void>;
}) {
  return (
    <div className="work-finding-detail">
      <span className={`work-risk ${finding.risk}`}>
        {finding.retryable ? '待重试' : labels[finding.risk]} · 第 {finding.paragraphId.slice(1)} 段
      </span>
      {finding.quote && <blockquote>{finding.quote.slice(0, 500)}</blockquote>}
      <h3>为什么需要核对</h3>
      <p>{finding.reason}</p>
      <h3>修改建议</h3>
      <p>{finding.suggestion}</p>
      {finding.revision && (
        <>
          <h3>参考表达 · 请核对事实</h3>
          <p>{finding.revision}</p>
        </>
      )}
      <button
        className="work-link"
        onClick={() =>
          void onCopy([finding.suggestion, finding.revision].filter(Boolean).join('\n\n'))
        }
      >
        <Copy size={15} /> 复制建议
      </button>
    </div>
  );
}
