import path from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ApiError } from './http';
import type { PageText } from '@/lib/types';
import { choosePaperTitle, titleFromFirstPage } from '@/lib/paper-title';

async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return getDocument({
    data: new Uint8Array(bytes),
    enableXfa: false,
    useSystemFonts: true,
    cMapUrl: path.resolve('node_modules/pdfjs-dist/cmaps').replaceAll('\\', '/') + '/',
    cMapPacked: true,
    wasmUrl: path.resolve('node_modules/pdfjs-dist/wasm').replaceAll('\\', '/') + '/',
    standardFontDataUrl:
      path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/',
    verbosity: 0,
  }).promise;
}
export async function readMetadata(bytes: Uint8Array, name: string) {
  let pdf: PDFDocumentProxy | undefined;
  try {
    pdf = await openPdf(bytes);
    const metadata = await pdf.getMetadata();
    const info = metadata.info as Record<string, unknown>;
    const str = (key: string) => (typeof info[key] === 'string' ? (info[key] as string) : '');
    let inferred = '';
    try {
      const first = await pdf.getPage(1);
      const text = await first.getTextContent();
      inferred = titleFromFirstPage(
        text.items.filter((item) => 'str' in item),
        first.getViewport({ scale: 1 }).height,
      );
    } catch {
      /* A missing or damaged text layer must not prevent reading a valid PDF. */
    }
    const title = choosePaperTitle(str('Title'), name, inferred);
    return { title, pageCount: pdf.numPages };
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException')
      throw new ApiError(422, 'PDF 已加密，请先解除密码再导入');
    throw new ApiError(422, '无法解析 PDF，请检查文件是否损坏或格式是否正确');
  } finally {
    await pdf?.loadingTask.destroy();
  }
}
export async function extractPages(bytes: Uint8Array, allowScanned = false): Promise<PageText[]> {
  let pdf: PDFDocumentProxy | undefined;
  try {
    pdf = await openPdf(bytes);
    const pages: PageText[] = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const source = await pdf.getPage(page);
      try {
        const content = await source.getTextContent();
        pages.push({
          page,
          text: content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
        });
      } finally {
        source.cleanup();
      }
    }
    if (!allowScanned && pages.reduce((sum, page) => sum + page.text.trim().length, 0) < 20)
      throw new ApiError(422, '文献缺少可提取的文本层，扫描件需要先进行 OCR；原文阅读仍可使用');
    return pages;
  } finally {
    await pdf?.loadingTask.destroy();
  }
}
export async function renderPageImages(bytes: Uint8Array, numbers: number[]) {
  const pdf = await openPdf(bytes);
  const factory = pdf.canvasFactory as {
    create: (
      width: number,
      height: number,
    ) => { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
    destroy: (holder: unknown) => void;
  };
  try {
    const images: { page: number; url: string }[] = [];
    for (const number of numbers.slice(0, 4)) {
      if (number < 1 || number > pdf.numPages) throw new ApiError(400, '图像页码超出文献范围');
      const page = await pdf.getPage(number),
        base = page.getViewport({ scale: 1 }),
        viewport = page.getViewport({
          scale: Math.min(2, 1440 / Math.max(base.width, base.height)),
        });
      const holder = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvas: holder.canvas, canvasContext: holder.context, viewport })
          .promise;
        images.push({ page: number, url: holder.canvas.toDataURL('image/jpeg', 0.82) });
      } finally {
        factory.destroy(holder);
        page.cleanup();
      }
    }
    return images;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
