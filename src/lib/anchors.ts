import type { ReadingAnchor } from './types';
export function parseAnchor(json: string | null | undefined): ReadingAnchor | null {
  try {
    const value = JSON.parse(json || 'null') as ReadingAnchor | null;
    return value?.version === 1 && Array.isArray(value.locations) ? value : null;
  } catch {
    return null;
  }
}
export function captureTextAnchor(root: HTMLElement, range: Range): ReadingAnchor | null {
  const locations: ReadingAnchor['locations'] = [];
  for (const layer of root.querySelectorAll<HTMLElement>('.pdf-page.ready .textLayer')) {
    if (!range.intersectsNode(layer)) continue;
    const pageElement = layer.closest<HTMLElement>('.pdf-page')!;
    const box = pageElement.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const rects: [number, number, number, number][] = [];
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()) && rects.length < 300) {
      if (!node.textContent || !range.intersectsNode(node)) continue;
      const part = document.createRange();
      part.setStart(node, range.startContainer === node ? range.startOffset : 0);
      part.setEnd(node, range.endContainer === node ? range.endOffset : node.textContent.length);
      for (const rect of part.getClientRects()) {
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        const x = Math.max(0, (rect.left - box.left) / box.width),
          y = Math.max(0, (rect.top - box.top) / box.height);
        const w = Math.min(1 - x, rect.width / box.width),
          h = Math.min(1 - y, rect.height / box.height);
        if (w > 0 && h > 0) rects.push([x, y, w, h]);
      }
    }
    if (rects.length) locations.push({ page: Number(pageElement.dataset.page), rects });
    if (locations.length === 10) break;
  }
  return locations.length ? { version: 1, locations } : null;
}
