export interface WorkParagraph {
  id: string;
  text: string;
  page: number | null;
  heading: string;
}
export interface WorkFinding {
  paragraphId: string;
  quote: string;
  start: number;
  end: number;
  risk: 'high' | 'medium' | 'low';
  reason: string;
  suggestion: string;
  revision: string;
  score?: number;
}
export interface WorkMatch {
  paragraphId: string;
  start: number;
  end: number;
  sourceId: string;
  sourceTitle: string;
  url: string;
  sourceQuote: string;
}
export interface WorkResults {
  findings?: WorkFinding[];
  matches?: WorkMatch[];
  percentage?: number | null;
  comparedSources?: number;
  checkedParagraphs?: number;
  totalParagraphs?: number;
  warnings?: string[];
  model?: string;
  engine?: string;
  excludedCharacters?: number;
}
export interface WorkTask {
  id: string;
  kind: 'aigc' | 'similarity';
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  progress: string;
  error: string;
  results: WorkResults;
  createdAt: string;
}
export interface WorkSource {
  id: string;
  title: string;
  url: string;
  characters: number;
}
export interface WorkDocument {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  paragraphs: WorkParagraph[];
  tasks: WorkTask[];
  sources: WorkSource[];
}

export function makeParagraphs(pages: { text: string; page: number | null }[]): WorkParagraph[] {
  const result: WorkParagraph[] = [];
  let heading = '正文';
  for (const page of pages) {
    for (const block of page.text
      .split(/\n\s*\n|\r?\n/)
      .map((text) => text.trim())
      .filter(Boolean)) {
      if (
        block.length < 65 &&
        /^(?:\d+(?:\.\d+)*[\s、.]|摘要|Abstract|参考文献|References|结论|Conclusion)/i.test(block)
      )
        heading = block;
      let remaining = block;
      while (remaining.length) {
        let end = Math.min(1400, remaining.length);
        if (end < remaining.length) {
          const cut = Math.max(remaining.lastIndexOf('。', end), remaining.lastIndexOf('. ', end));
          if (cut > 600) end = cut + 1;
        }
        const text = remaining.slice(0, end).trim();
        remaining = remaining.slice(end);
        if (text) result.push({ id: `p${result.length + 1}`, text, page: page.page, heading });
      }
    }
  }
  return result;
}
export function isReferenceParagraph(paragraph: WorkParagraph) {
  return /^(参考文献|references|bibliography)/i.test(
    paragraph.heading.trim().replace(/^\d+(?:\.\d+)*[\s.、:：]+/, ''),
  );
}
export function mergeRanges(ranges: { start: number; end: number }[]) {
  const merged: { start: number; end: number }[] = [];
  for (const item of [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && item.start <= previous.end) previous.end = Math.max(previous.end, item.end);
    else merged.push({ ...item });
  }
  return merged;
}
export function comparable(text: string) {
  const chars: string[] = [];
  const positions: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    if (/[\p{L}\p{N}]/u.test(character)) {
      const normalized = character.normalize('NFKC').toLowerCase();
      for (let i = 0; i < normalized.length; i++) {
        chars.push(normalized[i]);
        positions.push(offset);
        ends.push(offset + character.length);
      }
    }
    offset += character.length;
  }
  return { text: chars.join(''), positions, ends };
}
// Match literal runs, never count a language-model assertion as a source match.
export function findLiteralMatches(text: string, source: string, minimum = 24) {
  return createLiteralMatcher(source, minimum)(text);
}
export function createLiteralMatcher(source: string, minimum = 24) {
  const b = comparable(source);
  const index = new Map<string, number[]>();
  const seed = 12;
  for (let j = 0; j <= b.text.length - seed; j++) {
    const key = b.text.slice(j, j + seed);
    const list = index.get(key) || [];
    if (list.length < 12) list.push(j);
    index.set(key, list);
  }
  return (text: string) => {
    const a = comparable(text);
    const matches: { start: number; end: number; sourceQuote: string }[] = [];
    for (let i = 0; i <= a.text.length - minimum; i++) {
      let best = 0,
        bestJ = 0;
      for (const j of index.get(a.text.slice(i, i + seed)) || []) {
        let n = seed;
        while (i + n < a.text.length && j + n < b.text.length && a.text[i + n] === b.text[j + n])
          n++;
        if (n > best) {
          best = n;
          bestJ = j;
        }
      }
      if (best >= minimum) {
        const start = a.positions[i],
          end = a.ends[i + best - 1];
        matches.push({
          start,
          end,
          sourceQuote: source.slice(b.positions[bestJ], b.ends[bestJ + best - 1]),
        });
        i += best - 1;
      }
    }
    return matches;
  };
}
export function calculateSimilarity(
  paragraphs: WorkParagraph[],
  matches: WorkMatch[],
  excludeReferences: boolean,
) {
  const included = paragraphs.filter((p) => !excludeReferences || !isReferenceParagraph(p));
  let total = 0,
    repeated = 0,
    excluded = 0;
  for (const p of paragraphs) {
    const size = comparable(p.text).text.length;
    if (!included.includes(p)) {
      excluded += size;
      continue;
    }
    total += size;
    for (const range of mergeRanges(matches.filter((m) => m.paragraphId === p.id)))
      repeated += comparable(p.text.slice(range.start, range.end)).text.length;
  }
  return {
    percentage: total ? Math.round((10000 * repeated) / total) / 100 : 0,
    excludedCharacters: excluded,
  };
}
