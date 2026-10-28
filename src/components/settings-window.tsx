'use client';
import * as Modal from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import {
  Settings2,
  FileText,
  Sparkles,
  BookOpen,
  ShieldCheck,
  CircleHelp,
  Search,
  X,
} from 'lucide-react';
import type { AppPreferences, AppSettings, Paper } from '@/lib/types';
import { AiSettings } from './ai-settings';
import { Button } from './ui/button';
import { desktopAction } from '@/lib/desktop';
import { fileSize } from '@/lib/utils';
const sections = [
  ['general', '常规', Settings2, '导入 自动解读 默认页面'],
  ['files', '文件与存储', FileText, '导入 PDF 数据目录 备份'],
  ['ai', 'AI 配置', Sparkles, 'API Key 模型 服务'],
  ['reading', '阅读与外观', BookOpen, '主题 颜色 宽度 动画 缩放'],
  ['privacy', '隐私与提示', ShieldCheck, '隐私 提示条 全文 图像'],
  ['about', '快捷键与关于', CircleHelp, '帮助 日志 版本'],
] as const;
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
export function SettingsWindow({
  open,
  onOpenChange,
  initialSection,
  settings,
  onAiSaved,
  preferences,
  onPreferences,
  papers,
  onUpload,
  onError,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initialSection: string;
  settings: AppSettings | null;
  onAiSaved: (settings: AppSettings) => void;
  preferences: AppPreferences;
  onPreferences: (patch: Partial<AppPreferences>) => void;
  papers: Paper[];
  onUpload: () => void;
  onError: (message: string) => void;
}) {
  const [section, setSection] = useState(initialSection),
    [search, setSearch] = useState('');
  useEffect(() => {
    if (open) {
      setSection(initialSection);
      setSearch('');
    }
  }, [open, initialSection]);
  const selected = sections.find(([id]) => id === section) || sections[0];
  async function action(name: string) {
    try {
      await desktopAction(name);
    } catch (error) {
      onError(error instanceof Error ? error.message : '操作失败');
    }
  }
  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Overlay className="dialog-overlay" />
        <Modal.Content className="settings-window">
          <aside className="settings-nav">
            <Modal.Title>设置</Modal.Title>
            <Modal.Description className="sr-only">
              管理文献导入、AI 服务、阅读体验及隐私。
            </Modal.Description>
            <label className="settings-search">
              <Search size={15} />
              <input
                aria-label="搜索设置"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索设置"
              />
            </label>
            <nav aria-label="设置分类">
              {sections
                .filter(([, name, , keywords]) =>
                  (name + keywords).toLowerCase().includes(search.toLowerCase()),
                )
                .map(([id, name, Icon]) => (
                  <button
                    key={id}
                    aria-current={section === id ? 'page' : undefined}
                    onClick={() => setSection(id)}
                  >
                    <Icon size={17} />
                    {name}
                  </button>
                ))}
            </nav>
            <small>知页 · 让阅读更清晰</small>
          </aside>
          <section className="settings-page" aria-labelledby={`settings-${selected[0]}`}>
            <h2 id={`settings-${selected[0]}`}>{selected[1]}</h2>
            {section === 'general' && (
              <>
                <p className="settings-lead">选择适合你的文献阅读方式，修改后自动保存到本机。</p>
                <div className="settings-card">
                  <label className="setting-row">
                    <span>
                      <strong>打开文献时显示</strong>
                      <small>默认先看解读，也可以直接进入原文。</small>
                    </span>
                    <select
                      aria-label="打开文献时显示"
                      value={preferences.defaultView}
                      onChange={(event) =>
                        onPreferences({
                          defaultView: event.target.value as AppPreferences['defaultView'],
                        })
                      }
                    >
                      <option value="report">解读报告</option>
                      <option value="original">原文</option>
                    </select>
                  </label>
                  <Toggle
                    label="导入后自动解读"
                    description="AI 已配置时，新导入文献会自动发送给所配置的服务。关闭后可手动生成报告。"
                    checked={preferences.autoInterpret}
                    onChange={(value) => onPreferences({ autoInterpret: value })}
                  />
                </div>
              </>
            )}
            {section === 'files' && (
              <>
                <p className="settings-lead">
                  文献按书架归档。删除书架会将文献移回默认书架，不会删除 PDF。
                </p>
                <div className="settings-card">
                  <div className="setting-row">
                    <span>
                      <strong>导入 PDF</strong>
                      <small>支持多文件。每份最多 {settings?.maxUploadMB || 50} MiB。</small>
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        onOpenChange(false);
                        onUpload();
                      }}
                    >
                      选择文件
                    </Button>
                  </div>
                  <div className="setting-row">
                    <span>
                      <strong>本机文献库</strong>
                      <small>
                        {papers.length} 篇 · PDF 总计{' '}
                        {fileSize(papers.reduce((sum, paper) => sum + paper.fileSize, 0))}
                      </small>
                    </span>
                    {settings?.desktopMode && (
                      <Button variant="secondary" onClick={() => void action('data')}>
                        打开数据目录
                      </Button>
                    )}
                  </div>
                </div>
                <p className="settings-note">
                  {settings?.desktopMode
                    ? '桌面资料保存在本机应用数据目录的 data 文件夹。'
                    : 'Web 资料保存在项目 data 目录。'}
                  关闭应用后备份数据库与 uploads 文件夹即可。升级数据库前会自动备份已有文献库。
                </p>
              </>
            )}
            {section === 'ai' && (
              <>
                <p className="settings-lead">
                  只需填写服务地址、API Key 和模型名称。阅读参数已预设，保存立即生效。
                </p>
                <div className="settings-card ai-card">
                  <AiSettings settings={settings} onSaved={onAiSaved} />
                </div>
                <p className="settings-note">
                  {settings?.aiEnabled
                    ? `已启用：${settings.aiHost} · ${settings.aiModel}`
                    : '未配置 AI：上传、阅读及笔记仍可独立使用。'}
                </p>
              </>
            )}
            {section === 'reading' && (
              <>
                <p className="settings-lead">保持阅读区简洁，把更多空间留给原文。</p>
                <fieldset className="settings-card theme-picker">
                  <legend>界面主题</legend>
                  <p>只调整侧栏、标题栏和工具栏等外围区域，阅读内容区保持纯白。</p>
                  <div>
                    {(
                      [
                        ['green', '浅绿色'],
                        ['blue', '浅蓝色'],
                        ['yellow', '浅黄色'],
                        ['white', '纯白色'],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value} className="theme-choice">
                        <input
                          type="radio"
                          name="interface-theme"
                          value={value}
                          aria-label={label}
                          checked={preferences.theme === value}
                          onChange={() => onPreferences({ theme: value })}
                        />
                        <span className={`theme-swatch theme-swatch-${value}`} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="settings-card">
                  <Toggle
                    label="原文默认适应宽度"
                    description="下次打开原文时，按阅读区宽度铺开页面。"
                    checked={preferences.readerFitWidth}
                    onChange={(value) => onPreferences({ readerFitWidth: value })}
                  />
                  <Toggle
                    label="减少动画"
                    description="减少过渡效果，适合偏好即时切换的阅读方式。"
                    checked={preferences.reduceMotion}
                    onChange={(value) => onPreferences({ reduceMotion: value })}
                  />
                  {settings?.desktopMode && (
                    <div className="setting-row">
                      <span>
                        <strong>界面缩放</strong>
                        <small>只调整工具界面，PDF 仍可独立缩放。</small>
                      </span>
                      <div className="setting-inline-actions">
                        <Button variant="secondary" onClick={() => void action('zoomOut')}>
                          缩小
                        </Button>
                        <Button variant="secondary" onClick={() => void action('resetZoom')}>
                          恢复
                        </Button>
                        <Button variant="secondary" onClick={() => void action('zoomIn')}>
                          放大
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            {section === 'privacy' && (
              <>
                <p className="settings-lead">
                  PDF、报告、笔记和历史保存在本机，没有账户和统计追踪。
                </p>
                <div className="settings-card">
                  <Toggle
                    label="显示 AI 使用提示条"
                    description="关闭只隐藏顶部提示，不会关闭 AI 或改变自动解读设置。"
                    checked={preferences.showAiNotice}
                    onChange={(value) => onPreferences({ showAiNotice: value })}
                  />
                </div>
                <div className="settings-card privacy-details">
                  <h3>什么时候会发送内容？</h3>
                  <p>
                    生成报告时会发送全文文字，视觉模型还会接收页面图像；追问会发送当前页、选区及有限的对话历史。内容只发往你配置的
                    AI 服务，图像、推理和回答会产生用量。
                  </p>
                  <p>
                    API Key 只由本机服务端读取，不回显。可在“AI 配置”中移除 Key 关闭
                    AI。删除提示条不会停止自动解读。
                  </p>
                </div>
              </>
            )}
            {section === 'about' && (
              <>
                <p className="settings-lead">知页 Paperleaf · 本地优先的文献阅读空间</p>
                <div className="settings-card shortcut-list">
                  <div>
                    <span>导入 PDF</span>
                    <kbd>Ctrl + O</kbd>
                  </div>
                  <div>
                    <span>搜索书架</span>
                    <kbd>Ctrl + F</kbd>
                  </div>
                  <div>
                    <span>全屏</span>
                    <kbd>F11</kbd>
                  </div>
                  <div>
                    <span>关闭设置或菜单</span>
                    <kbd>Esc</kbd>
                  </div>
                </div>
                {settings?.desktopMode && (
                  <div className="settings-card">
                    <div className="setting-row">
                      <span>
                        <strong>日志与版本</strong>
                        <small>遇到问题时，日志保存在本机，不会自动上传。</small>
                      </span>
                      <div className="setting-inline-actions">
                        <Button variant="secondary" onClick={() => void action('logs')}>
                          打开日志
                        </Button>
                        <Button variant="secondary" onClick={() => void action('about')}>
                          关于知页
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
          <Modal.Close className="settings-close" aria-label="关闭设置">
            <X size={20} />
          </Modal.Close>
        </Modal.Content>
      </Modal.Portal>
    </Modal.Root>
  );
}
