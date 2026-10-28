'use client';
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Check,
  CircleHelp,
  FileText,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  reportDefinitions,
  type AppSettings,
  type EvidencePoint,
  type PaperDetail,
} from '@/lib/types';
import { Button } from './ui/button';
import { statusLabels } from '@/lib/status';

export function ReportView({
  paper,
  settings,
  onGenerate,
  generating,
  onEvidence,
  onOriginal,
  onSettings,
}: {
  paper: PaperDetail;
  settings: AppSettings | null;
  onGenerate: (force: boolean) => void;
  generating: boolean;
  onEvidence: (point: EvidencePoint) => void;
  onOriginal: () => void;
  onSettings: () => void;
}) {
  const report = paper.report;
  const running = generating || report?.status === 'running';
  const sections = report?.sections || [];
  return (
    <div className="report-scroll">
      <article className="report-document">
        <div className="eyebrow">
          <span className="tiny-line" /> 文献解读{' '}
          <span className="eyebrow-en">READ WITH CLARITY</span>
        </div>
        <div className="report-heading">
          <h1>{paper.title}</h1>
          <span className={`report-status ${report?.status || 'idle'}`}>
            {running ? (
              <LoaderCircle size={13} className="spin" />
            ) : report?.status === 'complete' ? (
              <Check size={13} />
            ) : (
              <FileText size={13} />
            )}
            {running ? '正在解读' : statusLabels[report?.status || 'idle']}
          </span>
        </div>
        <p className="document-meta">
          {paper.pageCount} 页<span>·</span>
          {paper.fileName}
          <span>·</span>本地文献
        </p>
        <div className="report-intro">
          <div className="intro-symbol">
            <Sparkles size={23} strokeWidth={1.4} />
          </div>
          <div>
            <strong>先看全貌，再读细节。</strong>
            <p>把复杂的研究，拆成十个清晰的问题。点击带页码的依据，随时回到原文。</p>
          </div>
        </div>
        <div className="privacy-strip">
          <ShieldCheck size={15} />
          <p>
            {settings?.aiEnabled ? (
              <>
                解读会将全文文本{settings.aiVisionEnabled ? '及页面图像' : ''}发送至{' '}
                <strong>{settings.aiHost}</strong>（{settings.aiModel}
                ）。约 {paper.pageCount} 页，初估 {(paper.pageCount * 650).toLocaleString()}{' '}
                tokens；{settings.aiVisionEnabled ? '图片、推理、' : ''}分段及汇总会增加用量。
              </>
            ) : (
              <>
                PDF 和笔记保存在本机。<strong>未配置 AI</strong>，仍可自由阅读和记录。
              </>
            )}
          </p>
          <button onClick={onSettings}>
            了解配置 <ArrowUpRight size={12} />
          </button>
        </div>
        <div className="report-actions">
          <span>
            {sections.length ? (
              <>
                已完成 <strong>{sections.length} / 10</strong> 个板块
                {report?.status === 'complete' && ' · 已缓存到本机'}
              </>
            ) : (
              '一份报告，读懂研究的来龙去脉'
            )}
          </span>
          <div>
            <Button variant="ghost" size="sm" onClick={onOriginal}>
              <BookOpen size={15} />
              查看原文
            </Button>
            <Button
              variant={sections.length ? 'secondary' : 'default'}
              size="sm"
              disabled={running}
              onClick={() => onGenerate(report?.status === 'complete')}
            >
              {running ? (
                <LoaderCircle size={14} className="spin" />
              ) : sections.length ? (
                <RefreshCw size={14} />
              ) : (
                <Sparkles size={14} />
              )}
              {running
                ? '解读中'
                : !settings?.aiEnabled
                  ? '未配置 AI'
                  : report?.status === 'failed'
                    ? '继续解读'
                    : sections.length
                      ? '重新解读'
                      : '开始解读'}
            </Button>
          </div>
        </div>
        {running && (
          <div className="generation-status" role="status">
            <span className="pulse-dot" />
            <div>
              <strong>{report?.progress || '任务已提交，正在准备文本…'}</strong>
              <span>板块完成后会立即出现；切换到原文不影响生成。</span>
            </div>
            <span className="generation-count">{sections.length}/10</span>
          </div>
        )}
        {report?.error && !running && (
          <div className="error-banner" role="alert">
            <CircleHelp size={17} />
            <span>{report.error}</span>
          </div>
        )}
        <div className="report-body">
          <nav className="report-index" aria-label="解读目录">
            <span>CONTENTS</span>
            {reportDefinitions.map(([key, title], i) => (
              <a
                key={key}
                href={`#section-${key}`}
                className={sections.some((section) => section.key === key) ? 'ready' : ''}
              >
                <small>{String(i + 1).padStart(2, '0')}</small>
                {title}
                {sections.some((section) => section.key === key) && <Check size={11} />}
              </a>
            ))}
          </nav>
          <div className="report-sections">
            {reportDefinitions.map(([key, title, subtitle], i) => {
              const section = sections.find((entry) => entry.key === key);
              return (
                <section
                  key={key}
                  id={`section-${key}`}
                  className={`insight-section ${section ? 'has-content' : 'is-pending'}`}
                  data-testid={`section-${key}`}
                >
                  <div className="section-title">
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <h2>{title}</h2>
                      <p>{subtitle}</p>
                    </div>
                    {!section && running && i === sections.length && (
                      <LoaderCircle size={16} className="spin" />
                    )}
                  </div>
                  {section ? (
                    <>
                      <p className="section-conclusion">{section.conclusion}</p>
                      <ul className="insight-points">
                        {section.points.map((point, index) => (
                          <li key={index}>
                            <span className="point-marker" />
                            <div>
                              <p>{point.text}</p>
                              {point.page && (
                                <button
                                  className="evidence-link"
                                  onClick={() => onEvidence(point)}
                                  title={
                                    point.verified
                                      ? point.quote
                                      : '页码由模型提供，引句未匹配；请核对原文'
                                  }
                                >
                                  p.{point.page}
                                  <ArrowUpRight size={12} />
                                  {point.verified ? '查看原文依据' : '查看页面 · 依据未核实'}
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <div className="section-placeholder">
                      {running ? (
                        <>
                          <span className="skeleton long" />
                          <span className="skeleton" />
                        </>
                      ) : (
                        <span>
                          {settings?.aiEnabled
                            ? '生成解读后，内容会出现在这里'
                            : '配置 AI 后解锁文献解读'}
                        </span>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
        <footer className="report-footer">
          <LeafMark />
          保持好奇，也保留自己的判断。AI 解读仅供辅助，请结合原文核对。
          {report?.tokenUsage ? (
            <span>
              已记录用量 {report.tokenUsage.toLocaleString()} tokens · v{report.version}
            </span>
          ) : null}
        </footer>
        {!sections.length && !running && (
          <div className="report-bottom-action">
            <Button variant="secondary" onClick={onOriginal}>
              从原文开始阅读 <ArrowDown size={15} />
            </Button>
          </div>
        )}
      </article>
    </div>
  );
}
function LeafMark() {
  return <span className="leaf-mark">✳</span>;
}
