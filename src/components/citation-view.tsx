'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { defaultCitationSettings, formatAuthors, formatCitation } from '@/lib/citation';
import type { CitationSettings, PaperDetail, ReferenceData } from '@/lib/types';
import { Button } from './ui/button';

const fields: { name: keyof Omit<ReferenceData, 'type'>; label: string; placeholder?: string }[] = [
  { name: 'title', label: '文献标题' },
  { name: 'authors', label: '作者', placeholder: '按原文顺序输入，以分号分隔' },
  { name: 'year', label: '年份' },
  { name: 'journal', label: '期刊或会议名称' },
  { name: 'volume', label: '卷' },
  { name: 'issue', label: '期' },
  { name: 'pages', label: '页码' },
  { name: 'doi', label: 'DOI' },
  { name: 'publisher', label: '出版社' },
];

export function CitationView({ paper }: { paper: PaperDetail }) {
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [settings, setSettings] = useState<CitationSettings>(defaultCitationSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [aiSuggested, setAiSuggested] = useState(false);
  const [wordAvailable, setWordAvailable] = useState(false);
  useEffect(() => {
    setWordAvailable(typeof window.paperleafDesktop?.word === 'function');
    let active = true;
    Promise.all([
      api<ReferenceData>(`/api/papers/${paper.id}/reference`),
      api<CitationSettings>('/api/citation-settings'),
    ])
      .then(([data, style]) => {
        if (active) {
          setReference(data);
          setSettings(style);
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '读取失败');
      });
    return () => {
      active = false;
    };
  }, [paper.id]);
  async function wordAction(action: 'insert' | 'update') {
    if (!reference || !window.paperleafDesktop?.word) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/papers/${paper.id}/reference`, {
        method: 'PATCH',
        body: JSON.stringify({ reference, settings }),
      });
      const result = await window.paperleafDesktop.word({
        action,
        reference: { ...reference, paperId: paper.id, authors: formatAuthors(reference.authors) },
        settings,
      });
      setMessage(
        `Word 已更新：${result.citations} 处引用，${result.references} 篇参考文献。请检查并保存 Word 文档。`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Word 操作失败');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!reference) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/papers/${paper.id}/reference`, {
        method: 'PATCH',
        body: JSON.stringify({ reference, settings }),
      });
      setAiSuggested(false);
      setMessage('引用信息和格式已保存到本机');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  async function recognize() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ reference: ReferenceData; warning: string }>(
        `/api/ai/reference/${paper.id}`,
        { method: 'POST' },
      );
      setReference((current) => {
        if (!current) return result.reference;
        const merged = { ...current };
        for (const { name } of fields)
          if (!merged[name].trim()) merged[name] = result.reference[name];
        return merged;
      });
      setAiSuggested(true);
      setMessage(`${result.warning} 已填写空白字段，原有内容未覆盖。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '识别失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="citation-scroll">
      <section className="citation-document">
        <div className="eyebrow">
          <span className="tiny-line" /> 文献信息
        </div>
        <h1>文献引用</h1>
        <p>填写并核对文献资料。作者请按原文顺序填写。</p>
        <p className="citation-hint">
          在 Windows 桌面 Word
          打开目标文档并放置光标，再点击插入。引用按正文位置编号，重复引用共用编号；更改正文或格式后点击更新。暂不支持修订模式、受保护文档、脚注和页眉中的引用。
        </p>
        <div className="citation-actions">
          <Button
            disabled={busy || !reference || !wordAvailable}
            onClick={() => void wordAction('insert')}
          >
            插入到 Word
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !reference || !wordAvailable}
            onClick={() => void wordAction('update')}
          >
            更新 Word 引用与参考文献
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void recognize()}
          >
            AI 识别书目信息
          </Button>
          <Button type="button" disabled={busy || !reference} onClick={() => void save()}>
            保存引用信息
          </Button>
        </div>
        <p className="citation-hint">
          点击 AI 识别后，首页及前两页文字会发送至配置 1 的 AI
          服务；支持视觉的模型还会收到首页图像。AI 可能出错，请逐项核对后保存。
        </p>
        {message && (
          <p role="status" className={aiSuggested ? 'citation-warning' : ''}>
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="citation-warning">
            {error}
          </p>
        )}
        {reference && (
          <>
            <div className="citation-grid">
              <label>
                文献类型
                <select
                  className="text-input"
                  disabled={busy}
                  value={reference.type}
                  onChange={(event) =>
                    setReference({
                      ...reference,
                      type: event.target.value as ReferenceData['type'],
                    })
                  }
                >
                  <option value="journal">期刊文章</option>
                  <option value="book">图书</option>
                  <option value="thesis">学位论文</option>
                  <option value="conference">会议论文</option>
                  <option value="web">网络文献</option>
                  <option value="other">其他</option>
                </select>
              </label>
              {fields.map(({ name, label, placeholder }) => (
                <label key={name}>
                  {label}
                  <input
                    className="text-input"
                    disabled={busy}
                    value={reference[name]}
                    placeholder={placeholder}
                    maxLength={500}
                    onChange={(event) => setReference({ ...reference, [name]: event.target.value })}
                  />
                </label>
              ))}
            </div>
            <h2>引用格式</h2>
            <p className="citation-hint">
              使用字段占位符定制格式；标号必须包含 {'{{number}}'}，参考文献必须包含 {'{{title}}'}
              。支持
              number、authors、title、type、journal、year、volume、issue、pages、doi、publisher。
            </p>
            <div className="citation-formats">
              <label>
                文中标号
                <input
                  className="text-input"
                  disabled={busy}
                  value={settings.markerTemplate}
                  onChange={(event) =>
                    setSettings({ ...settings, markerTemplate: event.target.value })
                  }
                />
              </label>
              <label>
                文末参考文献
                <textarea
                  className="text-input"
                  disabled={busy}
                  value={settings.referenceTemplate}
                  rows={3}
                  onChange={(event) =>
                    setSettings({ ...settings, referenceTemplate: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="citation-preview">
              <strong>预览</strong>
              <p>文中：{formatCitation(settings.markerTemplate, reference, 1)}</p>
              <p>文末：{formatCitation(settings.referenceTemplate, reference, 1)}</p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
