'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  FilePenLine,
  LoaderCircle,
  MessageCircle,
  Plus,
  Quote,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AiHistory,
  AppSettings,
  Note,
  PaperDetail,
  SelectionContext,
  ReadingAnchor,
} from '@/lib/types';
import { Button } from './ui/button';
import { NotesPanel } from './notes-panel';

export function SidePanel({
  paper,
  aiSlot,
  onAiSlot,
  linkEnabled,
  onLinkEnabled,
  settings,
  selection,
  page,
  activeNoteId,
  busy,
  tab,
  onTab,
  onClose,
  onQuestion,
  onSaveAnswer,
  onAddNote,
  onNoteSaved,
  onDeleteNote,
  onJump,
  onClearSelection,
  onError,
}: {
  paper: PaperDetail;
  aiSlot: number;
  onAiSlot: (slot: number) => void;
  linkEnabled: boolean;
  onLinkEnabled: (enabled: boolean) => void;
  settings: AppSettings | null;
  selection: SelectionContext | null;
  page: number;
  activeNoteId: string | null;
  busy: boolean;
  tab: 'chat' | 'notes';
  onTab: (tab: 'chat' | 'notes') => void;
  onClose: () => void;
  onQuestion: (question: string, slot: number) => Promise<boolean>;
  onSaveAnswer: (item: AiHistory, withExcerpt: boolean) => Promise<void>;
  onAddNote: () => Promise<void>;
  onNoteSaved: (note: Note) => void;
  onDeleteNote: (id: string) => Promise<void>;
  onJump: (page: number, quote: string, anchor?: ReadingAnchor | null) => void;
  onClearSelection: () => void;
  onError: (message: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const profiles = settings?.aiProfiles?.filter((item) => item.enabled) || [];
  const currentProfile = profiles.find((item) => item.slot === aiSlot);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const historyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (tab === 'chat' && historyRef.current)
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [tab, paper.id, paper.history.length, pendingQuestion, busy]);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(320);
  function resizePanel(event: React.PointerEvent<HTMLDivElement>) {
    const handle = event.currentTarget,
      startX = event.clientX,
      startWidth = handle.parentElement!.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) =>
      setPanelWidth(Math.max(250, Math.min(520, startWidth + startX - e.clientX)));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
  async function copy(item: AiHistory) {
    try {
      await navigator.clipboard.writeText(item.answer);
      setCopied(item.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      onError('复制失败，请手动选择回答内容复制');
    }
  }
  return (
    <aside
      className={`side-panel ${tab === 'notes' ? 'notes-mode' : ''}`}
      style={{ '--panel-width': `${panelWidth}px` } as React.CSSProperties}
    >
      <div
        className="panel-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整笔记面板宽度"
        tabIndex={0}
        onPointerDown={resizePanel}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setPanelWidth((value) =>
              Math.max(250, Math.min(520, value + (event.key === 'ArrowLeft' ? 20 : -20))),
            );
          }
        }}
      />
      <header className="panel-header">
        <div>
          <button className={tab === 'chat' ? 'active' : ''} onClick={() => onTab('chat')}>
            <MessageCircle size={15} />
            AI 追问
          </button>
          <button className={tab === 'notes' ? 'active' : ''} onClick={() => onTab('notes')}>
            <FilePenLine size={15} />
            笔记<span>{paper.notes.length}</span>
          </button>
        </div>
        <button onClick={onClose} aria-label="收起追问面板">
          <X size={17} />
        </button>
      </header>
      {tab === 'notes' ? (
        <NotesPanel
          notes={paper.notes}
          currentPage={page}
          activeNoteId={activeNoteId}
          onAdd={onAddNote}
          onSaved={onNoteSaved}
          onDelete={onDeleteNote}
          onJump={onJump}
          onError={onError}
        />
      ) : (
        <>
          <div className="chat-context">
            <span>
              <span className="context-dot" />
              当前上下文 · 第 {selection?.page || page} 页
            </span>
          </div>
          <div className="chat-history" aria-live="polite" ref={historyRef}>
            {!paper.history.length && !pendingQuestion && (
              <div className="panel-empty">
                <span className="chat-empty-icon">
                  <Sparkles size={25} strokeWidth={1.3} />
                </span>
                <h3>让问题带着你读下去</h3>
                <p>在原文中选一段文字，或围绕当前页问一个问题。</p>
                <div className="suggestions">
                  {['这一页最重要的观点是什么？', '作者的方法有什么局限？'].map((text) => (
                    <button key={text} onClick={() => setQuestion(text)}>
                      {text}
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {paper.history.map((item) => (
              <article className="chat-item" key={item.id}>
                <div className="chat-question">
                  <span>你 · p.{item.page}</span>
                  <p>
                    {item.question ||
                      {
                        translate: '翻译这段文字',
                        explain: '通俗解释这段文字',
                        term: '解释这里的术语',
                        question: '追问',
                      }[item.action]}
                  </p>
                  {item.selectedText && <blockquote>{item.selectedText}</blockquote>}
                </div>
                <div className="chat-answer">
                  <span>
                    <Sparkles size={13} />
                    知页
                  </span>
                  <p>{item.answer}</p>
                  <div className="answer-actions">
                    <button onClick={() => void copy(item)}>
                      {copied === item.id ? <Check size={12} /> : <Copy size={12} />}
                      {copied === item.id ? '已复制' : '复制'}
                    </button>
                    <button
                      disabled={saving === item.id}
                      onClick={async () => {
                        setSaving(item.id);
                        try {
                          await onSaveAnswer(item, false);
                        } finally {
                          setSaving(null);
                        }
                      }}
                    >
                      <Plus size={12} />
                      存为笔记
                    </button>
                    {item.selectedText && (
                      <button
                        disabled={saving === item.id}
                        onClick={async () => {
                          setSaving(item.id);
                          try {
                            await onSaveAnswer(item, true);
                          } finally {
                            setSaving(null);
                          }
                        }}
                      >
                        <FilePenLine size={12} />
                        片段 + 解释
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {pendingQuestion && (
              <div className="chat-question chat-pending">
                <span>你 · p.{selection?.page || page}</span>
                <p>{pendingQuestion}</p>
              </div>
            )}
            {busy && (
              <div className="chat-thinking" role="status">
                <LoaderCircle size={15} className="spin" />
                正在结合原文思考…
              </div>
            )}
          </div>
          <div className="chat-compose">
            {selection && (
              <div className="selected-excerpt">
                <div>
                  <Quote size={13} />
                  <span>已选择 · p.{selection.page}</span>
                  <button onClick={onClearSelection} aria-label="清除选中文字">
                    <X size={13} />
                  </button>
                </div>
                <p>{selection.text}</p>
              </div>
            )}
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!question.trim() || busy) return;
                const text = question;
                setQuestion('');
                setPendingQuestion(text);
                try {
                  if (!(await onQuestion(text, aiSlot))) setQuestion((current) => current || text);
                } finally {
                  setPendingQuestion('');
                }
              }}
            >
              <textarea
                aria-label="追问问题"
                placeholder={
                  profiles.length || settings?.aiEnabled
                    ? '继续追问，或换个角度想一想…'
                    : '未配置 AI，可先阅读原文和记录笔记'
                }
                value={question}
                maxLength={2000}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <p className="compose-hint">Enter 发送 · Shift + Enter 换行</p>
              <div className="compose-actions">
                <label
                  className="link-toggle"
                  title="勾选后，在问题中输入书架文献的完整标题；最多联动 8 篇，截取的文字会发送至所选 AI 服务。后续追问沿用这些文献。"
                >
                  <input
                    type="checkbox"
                    checked={linkEnabled}
                    onChange={(event) => onLinkEnabled(event.target.checked)}
                  />
                  书架联动
                </label>
                <select
                  aria-label="选择回答模型"
                  value={aiSlot}
                  onChange={(event) => onAiSlot(Number(event.target.value))}
                >
                  {!profiles.some((item) => item.slot === aiSlot) && (
                    <option value={aiSlot}>未配置 AI</option>
                  )}
                  {profiles.map((item) => (
                    <option key={item.slot} value={item.slot}>
                      {item.model} · 配置 {item.slot}
                    </option>
                  ))}
                </select>
                <Button
                  size="icon"
                  aria-label="发送追问"
                  disabled={busy || !question.trim()}
                  type="submit"
                >
                  {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowUp size={16} />}
                </Button>
              </div>
            </form>
            <p className="model-destination">追问发送至：{currentProfile?.host || '未配置 AI'}</p>
            <p className="ai-disclaimer">AI 可能出错，请带着判断回到原文。</p>
          </div>
        </>
      )}
    </aside>
  );
}
