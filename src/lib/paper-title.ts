export function looksGarbled(text: string) {
  return /[\u0080-\u009f\ufffd]|(?:Ã.|Â.|å[\u0080-\u00ff]|æ[\u0080-\u00ff]|ç[\u0080-\u00ff])/u.test(
    text,
  );
}
export function repairEncoding(text: string): string {
  let result = text;
  for (let pass = 0; pass < 2 && looksGarbled(result); pass++) {
    if (Array.from(result).some((char) => char.charCodeAt(0) > 255)) break;
    try {
      const candidate = new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(result, (char) => char.charCodeAt(0)),
      );
      if (candidate === result) break;
      result = candidate;
    } catch {
      break;
    }
  }
  return result.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}
export interface TitleItem {
  str: string;
  height: number;
  width: number;
  transform: number[];
}
export function titleFromFirstPage(items: TitleItem[], pageHeight: number): string {
  const lines: { y: number; height: number; parts: TitleItem[] }[] = [];
  for (const item of [...items].sort((a, b) => b.transform[5] - a.transform[5])) {
    if (
      !item.str.trim() ||
      item.transform[5] > pageHeight * 0.91 ||
      item.transform[5] < pageHeight * 0.35
    )
      continue;
    const height = Math.max(item.height, Math.hypot(item.transform[2], item.transform[3]));
    const line = lines.find(
      (line) => Math.abs(line.y - item.transform[5]) < Math.max(line.height, height) * 0.43,
    );
    if (line) {
      line.parts.push(item);
      line.height = Math.max(line.height, height);
    } else lines.push({ y: item.transform[5], height, parts: [item] });
  }
  const content = (line: (typeof lines)[number]) =>
    line.parts
      .sort((a, b) => a.transform[4] - b.transform[4])
      .map((part) => {
        const value = part.str.replace(/[！-～]/g, (char) =>
          String.fromCharCode(char.charCodeAt(0) - 0xfee0),
        );
        if (part.height < line.height * 0.8 && part.transform[5] < line.y && /^\d+$/.test(value))
          return value.replace(/\d/g, (digit) => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]);
        return value;
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  const candidates = lines.filter((line) => content(line).length >= 4);
  if (!candidates.length) return '';
  const largest = candidates.reduce((best, line) => (line.height > best.height ? line : best));
  const selected = candidates
    .filter(
      (line) =>
        line.height >= largest.height * 0.84 &&
        Math.abs(line.y - largest.y) <= largest.height * 3.8,
    )
    .sort((a, b) => b.y - a.y);
  const result = selected.slice(0, 3).map(content).join('').trim();
  return result.length >= 6 && !looksGarbled(result) ? result.slice(0, 500) : '';
}
export function choosePaperTitle(metadata: string, fileName: string, inferred: string) {
  const cleaned = repairEncoding(metadata).replace(/\.pdf$/i, '');
  const fallback = repairEncoding(fileName).replace(/\.pdf$/i, '');
  const generic = /^(?:untitled|document\d*|microsoft\s+word.*|未命名.*)$/i.test(cleaned);
  if (cleaned.length >= 6 && !generic && !looksGarbled(cleaned) && !cleaned.includes('_'))
    return cleaned.slice(0, 500);
  if (inferred) return inferred;
  if (cleaned && !generic && !looksGarbled(cleaned)) return cleaned.slice(0, 500);
  return fallback && !looksGarbled(fallback) ? fallback.slice(0, 500) : '未命名文献';
}
