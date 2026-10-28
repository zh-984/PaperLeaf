'use client';
import { memo, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Languages,
  LoaderCircle,
  Maximize,
  MessageCircle,
  Minus,
  Plus,
  ScanText,
  Search,
  FilePenLine,
} from 'lucide-react';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  TextLayer as TextLayerType,
} from 'pdfjs-dist';
import type { AiAction, JumpTarget, Note, SelectionContext } from '@/lib/types';
import { captureTextAnchor } from '@/lib/anchors';
import { highlightQuote } from '@/lib/highlight';
import { Button } from './ui/button';
import { numberedNotes } from '@/lib/note-order';

const PdfPage = memo(function PdfPage({
  pdf,
  number,
  scale,
  size,
  root,
  notes,
  activeNoteId,
  jump,
  onNote,
  activePage,
}: {
  activePage: number;
  pdf: PDFDocumentProxy;
  number: number;
  scale: number;
  size: { width: number; height: number };
  root: HTMLDivElement | null;
  notes: Note[];
  activeNoteId: string | null;
  jump: JumpTarget | null;
  onNote: (id: string) => void;
}) {
  const highlighted = useRef<number | null>(null);
  const pageRef = useRef<HTMLDivElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null),
    textRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  const [dimensions, setDimensions] = useState(size),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root,
      rootMargin: '1000px 0px',
    });
    if (pageRef.current) observer.observe(pageRef.current);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    if (!near) {
      setReady(false);
      return;
    }
    let disposed = false;
    let task: RenderTask | undefined;
    let layer: TextLayerType | undefined;
    let renderedPage: PDFPageProxy | undefined;
    let renderedCanvas: HTMLCanvasElement | null = null;
    setReady(false);
    setError(false);
    void (async () => {
      try {
        const page = (renderedPage = await pdf.getPage(number));
        if (disposed || !canvasRef.current || !textRef.current) {
          page.cleanup();
          return;
        }
        const viewport = page.getViewport({ scale }),
          base = page.getViewport({ scale: 1 });
        setDimensions({ width: base.width, height: base.height });
        const canvas = canvasRef.current,
          ratio = Math.min(window.devicePixelRatio || 1, 2);
        renderedCanvas = canvas;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textRef.current.replaceChildren();
        task = page.render({
          canvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await task.promise;
        if (disposed) return;
        const { TextLayer } = await import('pdfjs-dist');
        layer = new TextLayer({
          textContentSource: await page.getTextContent(),
          container: textRef.current,
          viewport,
        });
        await layer.render();
        if (!disposed) setReady(true);
      } catch (cause) {
        if (!disposed && !(cause instanceof Error && cause.name === 'RenderingCancelledException'))
          setError(true);
      }
    })();
    return () => {
      disposed = true;
      task?.cancel();
      layer?.cancel();
      // Release offscreen page resources only after a cancelled render settles.
      void (task?.promise || Promise.resolve())
        .catch(() => undefined)
        .then(() => {
          if (renderedCanvas && !renderedCanvas.isConnected) {
            renderedCanvas.width = 0;
            renderedCanvas.height = 0;
          }
          renderedPage?.cleanup();
        })
        .catch(() => undefined);
    };
  }, [pdf, number, near, scale, retry]);
  useEffect(() => {
    if (ready && jump?.page === number && jump.quote && !jump.anchor && textRef.current) {
      highlightQuote(textRef.current, jump.quote, highlighted.current !== jump.nonce);
      highlighted.current = jump.nonce;
    }
  }, [ready, jump, number]);
  const related = numberedNotes(notes).filter(
    ({ note }) =>
      note.anchor?.locations.some((location) => location.page === number) ||
      (!note.anchor && note.page === number),
  );
  const target = jump?.anchor?.locations.find((location) => location.page === number);
  return (
    <div className="continuous-page-wrap">
      <div
        ref={pageRef}
        className={`pdf-page continuous-page ${ready ? 'ready' : ''}`}
        data-testid={activePage === number ? 'pdf-page' : undefined}
        data-page={number}
        style={
          {
            width: dimensions.width * scale,
            height: dimensions.height * scale,
            '--total-scale-factor': scale,
          } as React.CSSProperties
        }
      >
        {near && (
          <>
            <canvas ref={canvasRef} aria-label={`PDF 第 ${number} 页`} />
            <div
              ref={textRef}
              className="textLayer"
              data-testid={activePage === number ? 'pdf-text-layer' : undefined}
              data-page-text={number}
            />
          </>
        )}
        {!ready && (
          <div className="page-placeholder">
            {error ? (
              <button onClick={() => setRetry((value) => value + 1)}>
                第 {number} 页加载失败，点击重试
              </button>
            ) : (
              <>
                <LoaderCircle size={19} className={near ? 'spin' : ''} />第 {number} 页
              </>
            )}
          </div>
        )}
        <div className="note-overlay">
          {related.map(({ note, number: noteNumber }, index) => {
            const location = note.anchor?.locations.find((item) => item.page === number),
              top = location?.rects[0]?.[1] ?? location?.position ?? 0.04;
            return (
              <div key={note.id}>
                {location?.rects.map(([x, y, w, h], i) => (
                  <span
                    key={i}
                    className={`note-highlight ${activeNoteId === note.id ? 'active' : ''}`}
                    style={{
                      left: `${x * 100}%`,
                      top: `${y * 100}%`,
                      width: `${w * 100}%`,
                      height: `${h * 100}%`,
                    }}
                  />
                ))}
                <button
                  className={`page-note-marker ${activeNoteId === note.id ? 'active' : ''}`}
                  style={{ top: `${Math.min(0.96, top) * 100}%`, right: -36 - (index % 2) * 8 }}
                  title={note.content || '打开关联笔记'}
                  aria-label={`第 ${number} 页笔记 ${noteNumber}`}
                  onClick={() => onNote(note.id)}
                >
                  （{noteNumber}）
                </button>
              </div>
            );
          })}
          {target?.rects.map(([x, y, w, h], index) => (
            <span
              key={`target-${index}`}
              className="note-highlight target-highlight"
              style={{
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="page-bottom-label">— {number} —</div>
    </div>
  );
});

export function PdfReader({
  paperId,
  initialPage,
  initialPosition = 0,
  initialFit = true,
  jump,
  notes,
  activeNoteId,
  onNoteActivate,
  onNoteCreate,
  onPage,
  onAsk,
  onSelection,
  onError,
}: {
  paperId: string;
  initialPage: number;
  initialPosition?: number;
  initialFit?: boolean;
  jump: JumpTarget | null;
  notes: Note[];
  activeNoteId: string | null;
  onNoteActivate: (id: string) => void;
  onNoteCreate: (selection: SelectionContext) => void;
  onPage: (page: number, position?: number) => void;
  onAsk: (action: AiAction, selection: SelectionContext) => void;
  onSelection: (selection: SelectionContext) => void;
  onError: (message: string) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [size, setSize] = useState({ width: 595, height: 842 }),
    [error, setError] = useState('');
  const [page, setPage] = useState(initialPage),
    [input, setInput] = useState(String(initialPage)),
    [width, setWidth] = useState(800),
    [zoom, setZoom] = useState(1),
    [fit, setFit] = useState(initialFit);
  const [selection, setSelection] = useState<(SelectionContext & { x: number; y: number }) | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null),
    callbacks = useRef({ onPage, onError }),
    initial = useRef({ page: initialPage, position: initialPosition });
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const consumedJump = useRef<number | null>(null);
  const restoring = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    position = useRef(initialPosition),
    pageRef = useRef(initialPage);
  useEffect(() => {
    callbacks.current = { onPage, onError };
  }, [onPage, onError]);
  const scale = fit ? Math.max(0.2, Math.min(2.5, (width - 80) / size.width)) : zoom;
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
        // Canvas and selectable text only: no PDF JavaScript / scripting manager.
        task = pdfjs.getDocument({
          url: `/api/papers/${paperId}/file`,
          enableXfa: false,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          wasmUrl: '/pdfjs/wasm/',
        });
        const document = await task.promise,
          first = await document.getPage(1),
          viewport = first.getViewport({ scale: 1 });
        if (!disposed) {
          setSize({ width: viewport.width, height: viewport.height });
          setPdf(document);
        }
      } catch {
        if (!disposed) setError('PDF 加载失败，请检查本地文件或解密后重新导入');
      }
    })();
    return () => {
      disposed = true;
      void task?.destroy();
    };
  }, [paperId]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setScrollRoot(element);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Restore a page-relative position after zoom/layout, and use the same coordinate system for notes.
  useEffect(() => {
    if (!pdf || !scrollRef.current) return;
    restoring.current = true;
    const isNewJump = jump && consumedJump.current !== jump.nonce;
    const destination = isNewJump
      ? {
          page: jump.page,
          position:
            jump.anchor?.locations.find((location) => location.page === jump.page)?.rects[0]?.[1] ??
            jump.anchor?.locations[0]?.position ??
            0,
        }
      : initial.current;
    const frame = requestAnimationFrame(() => {
      const root = scrollRef.current!,
        element = root.querySelector<HTMLElement>(`.pdf-page[data-page="${destination.page}"]`);
      if (element) {
        root.scrollTop =
          element.offsetTop +
          element.offsetHeight * destination.position -
          (isNewJump ? Math.min(120, root.clientHeight * 0.18) : 0);
        pageRef.current = destination.page;
        position.current = destination.position;
        setPage(destination.page);
        setInput(String(destination.page));
        initial.current = destination;
        if (isNewJump) callbacks.current.onPage(destination.page, destination.position);
      }
      consumedJump.current = jump?.nonce ?? null;
      requestAnimationFrame(() => {
        restoring.current = false;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [pdf, scale, jump]);
  function track() {
    setSelection(null);
    if (restoring.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const root = scrollRef.current;
      if (!root) return;
      const elements = Array.from(root.querySelectorAll<HTMLElement>('.pdf-page'));
      const y = root.scrollTop + Math.min(120, root.clientHeight * 0.18);
      const current =
        elements.find((element) => element.offsetTop + element.offsetHeight > y) || elements.at(-1);
      if (!current) return;
      const next = Number(current.dataset.page),
        within = Math.max(
          0,
          Math.min(1, (root.scrollTop - current.offsetTop) / current.offsetHeight),
        );
      pageRef.current = next;
      position.current = within;
      initial.current = { page: next, position: within };
      setPage(next);
      setInput(String(next));
      callbacks.current.onPage(next, within);
    }, 160);
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function goTo(value: number) {
    if (!pdf || !Number.isFinite(value)) return;
    const next = Math.max(1, Math.min(pdf.numPages, Math.floor(value))),
      root = scrollRef.current;
    const element = root?.querySelector<HTMLElement>(`.pdf-page[data-page="${next}"]`);
    if (root && element) root.scrollTo({ top: element.offsetTop - 20, behavior: 'instant' });
    setPage(next);
    setInput(String(next));
    initial.current = { page: next, position: 0 };
    callbacks.current.onPage(next, 0);
  }
  function selectText() {
    const selected = window.getSelection(),
      root = scrollRef.current;
    if (
      !selected ||
      !root ||
      selected.isCollapsed ||
      !selected.rangeCount ||
      !root.contains(selected.anchorNode) ||
      !root.contains(selected.focusNode)
    ) {
      setSelection(null);
      return;
    }
    const text = selected.toString().trim();
    if (!text) return;
    const range = selected.getRangeAt(0),
      box = range.getBoundingClientRect(),
      anchor = captureTextAnchor(root, range);
    const context: SelectionContext = {
      text: text.slice(0, 12000),
      page: anchor?.locations[0]?.page || page,
      anchor,
    };
    setSelection({
      ...context,
      x: Math.max(8, Math.min(window.innerWidth - 470, box.left)),
      y: Math.min(window.innerHeight - 65, box.bottom + 10),
    });
    onSelection(context);
    if (text.length > 12000) callbacks.current.onError('选区较长，追问将使用前 12,000 个字符');
  }
  const actions: [AiAction, string, typeof Languages][] = [
    ['translate', '翻译', Languages],
    ['explain', '通俗解释', ScanText],
    ['term', '术语解释', Search],
    ['question', '追问', MessageCircle],
  ];
  return (
    <div className="reader continuous-reader">
      <div className="reader-toolbar">
        <div className="page-navigation">
          <Button
            variant="ghost"
            size="icon"
            disabled={!pdf || page <= 1}
            onClick={() => goTo(page - 1)}
            aria-label="上一页"
          >
            <ArrowLeft size={17} />
          </Button>
          <label>
            <input
              aria-label="页码"
              inputMode="numeric"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onBlur={() => goTo(Number(input))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') goTo(Number(input));
              }}
            />
            <span>/ {pdf?.numPages || '—'}</span>
          </label>
          <Button
            variant="ghost"
            size="icon"
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => goTo(page + 1)}
            aria-label="下一页"
          >
            <ArrowRight size={17} />
          </Button>
        </div>
        <div className="zoom-controls">
          <Button
            variant="ghost"
            size="icon"
            aria-label="缩小"
            onClick={() => {
              setZoom(Math.max(0.25, scale - 0.2));
              setFit(false);
            }}
          >
            <Minus size={16} />
          </Button>
          <span aria-label="缩放比例">{Math.round(scale * 100)}%</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="放大"
            onClick={() => {
              setZoom(Math.min(3, scale + 0.2));
              setFit(false);
            }}
          >
            <Plus size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={fit ? 'is-active' : ''}
            onClick={() => setFit(true)}
          >
            <Maximize size={15} />
            适应宽度
          </Button>
        </div>
        <span className="reader-hint">连续滚动 · 划词记笔记或追问</span>
      </div>
      <div
        className="pdf-scroll"
        ref={scrollRef}
        onScroll={track}
        onMouseUp={selectText}
        onKeyUp={selectText}
      >
        {error ? (
          <div className="reader-error" role="alert">
            {error}
          </div>
        ) : !pdf ? (
          <div className="pdf-loading">
            <LoaderCircle className="spin" />
            正在打开文献…
          </div>
        ) : (
          Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index + 1}
              pdf={pdf}
              number={index + 1}
              activePage={page}
              scale={scale}
              size={size}
              root={scrollRoot}
              notes={notes}
              activeNoteId={activeNoteId}
              jump={jump}
              onNote={onNoteActivate}
            />
          ))
        )}
      </div>
      {selection && (
        <div
          className="selection-toolbar"
          style={{ left: selection.x, top: selection.y }}
          role="toolbar"
          aria-label="划词操作"
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            onClick={() => {
              onNoteCreate(selection);
              setSelection(null);
            }}
          >
            <FilePenLine size={15} />
            记笔记
          </button>
          {actions.map(([action, label, Icon]) => (
            <button
              key={action}
              onClick={() => {
                onAsk(action, selection);
                setSelection(null);
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
