'use client';
import { BookOpen, Check, ChevronDown, Leaf, ScanText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
export function ModeBrand({
  mode,
  onChange,
}: {
  mode: 'read' | 'work';
  onChange: (mode: 'read' | 'work') => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <div
      className="mode-brand"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <button
        className="brand mode-trigger"
        aria-label="切换 Read / Work 模式"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="brand-icon">
          <Leaf size={22} />
        </span>
        <span className="brand-copy">
          <span className="brand-title">
            知页{mode === 'work' && <small className="brand-work">work</small>}
          </span>
          <span className="brand-en">PaperLeaf {mode === 'read' ? 'Read' : 'Work'}</span>
        </span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <div role="menu" className="mode-menu">
          {(['read', 'work'] as const).map((item) => (
            <button
              key={item}
              role="menuitemradio"
              aria-checked={mode === item}
              onClick={() => {
                setOpen(false);
                onChange(item);
              }}
            >
              {item === 'read' ? <BookOpen size={18} /> : <ScanText size={18} />}
              <span>
                <strong>PaperLeaf {item === 'read' ? 'Read' : 'Work'}</strong>
                <small>{item === 'read' ? '阅读、解读与引用' : '稿件检查与修改建议'}</small>
              </span>
              {mode === item && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
