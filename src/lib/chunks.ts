import type { EvidencePoint, PageText } from './types';

export function splitPages(pages: PageText[], budget: number): string[] {
  if (budget < 100) throw new Error('Chunk budget is too small');
  const chunks: string[] = [];
  let current = '';
  for (const page of pages) {
    const prefix = `[p.${page.page}] `;
    let offset = 0;
    while (offset < page.text.length) {
      const available = budget - current.length - prefix.length - 1;
      if (available <= 0) {
        chunks.push(current);
        current = '';
        continue;
      }
      const slice = page.text.slice(offset, offset + available);
      current += `${prefix}${slice}\n`;
      offset += slice.length;
      if (current.length >= budget - prefix.length - 1) {
        chunks.push(current);
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
export function normalizeEvidence(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
export function verifyEvidence(
  point: Omit<EvidencePoint, 'verified'>,
  pages: PageText[],
): EvidencePoint {
  const page = point.page && pages.find((entry) => entry.page === point.page);
  const quote = normalizeEvidence(point.quote);
  const verified = Boolean(
    page && quote.length >= 4 && normalizeEvidence(page.text).includes(quote),
  );
  return { ...point, page: page ? point.page : null, quote: verified ? point.quote : '', verified };
}
