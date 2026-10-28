'use client';
import { useEffect, useRef, useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { desktopAction } from '@/lib/desktop';
const menus = [
  [
    '文件',
    [
      ['import', '导入 PDF', 'Ctrl+O'],
      ['newShelf', '新建书架', ''],
      ['settings', '设置与隐私', ''],
      ['data', '打开数据目录', ''],
      ['quit', '退出', 'Alt+F4'],
    ],
  ],
  [
    '编辑',
    [
      ['undo', '撤销', 'Ctrl+Z'],
      ['redo', '重做', 'Ctrl+Y'],
      ['cut', '剪切', 'Ctrl+X'],
      ['copy', '复制', 'Ctrl+C'],
      ['paste', '粘贴', 'Ctrl+V'],
      ['selectAll', '全选', 'Ctrl+A'],
      ['find', '搜索书架', 'Ctrl+F'],
    ],
  ],
  [
    '查看',
    [
      ['sidebar', '显示 / 收起书架', ''],
      ['reload', '刷新', ''],
      ['zoomIn', '放大界面', ''],
      ['zoomOut', '缩小界面', ''],
      ['resetZoom', '恢复界面缩放', ''],
      ['fullscreen', '全屏', 'F11'],
      ['restart', '重启应用', ''],
    ],
  ],
  [
    '帮助',
    [
      ['settingsAbout', '快捷键与关于', ''],
      ['logs', '打开日志目录', ''],
      ['about', '关于知页', ''],
    ],
  ],
] as const;
export function DesktopTitlebar({
  onSettings,
  onNewShelf,
  onToggleShelf,
  onSearch,
  onError,
}: {
  onSettings: (section?: string) => void;
  onNewShelf: () => void;
  onToggleShelf: () => void;
  onSearch: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null),
    root = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  async function run(action: string) {
    setOpen(null);
    if (action === 'settings') return onSettings();
    if (action === 'settingsAbout') return onSettings('about');
    if (action === 'newShelf') return onNewShelf();
    if (action === 'sidebar') return onToggleShelf();
    if (action === 'find') return onSearch();
    try {
      await desktopAction(action);
    } catch (error) {
      onError(error instanceof Error ? error.message : '操作失败');
    }
  }
  return (
    <header
      className="desktop-titlebar"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(null);
      }}
    >
      <button className="titlebar-sidebar" aria-label="显示或收起书架" onClick={onToggleShelf}>
        <PanelLeft size={17} />
      </button>
      <nav className="desktop-menubar" role="menubar" aria-label="应用菜单">
        {menus.map(([label, items]) => (
          <div className="desktop-menu" key={label}>
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpen(open === label ? null : label)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setOpen(label);
                  requestAnimationFrame(() =>
                    root.current
                      ?.querySelector<HTMLButtonElement>(`.desktop-menu-popup button`)
                      ?.focus(),
                  );
                }
              }}
            >
              {label}
            </button>
            {open === label && (
              <div className="desktop-menu-popup" role="menu" aria-label={label}>
                {items.map(([action, text, key]) => (
                  <button
                    key={action}
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void run(action)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        const buttons = Array.from(
                          event.currentTarget.parentElement!.querySelectorAll('button'),
                        );
                        buttons[
                          (buttons.indexOf(event.currentTarget) +
                            (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
                            buttons.length
                        ]?.focus();
                      }
                    }}
                  >
                    <span>{text}</span>
                    <kbd>{key}</kbd>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </header>
  );
}
