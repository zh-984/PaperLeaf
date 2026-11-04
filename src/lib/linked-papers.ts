import type { Bookshelf, Paper } from './types';
import { formatScientificText, scientificRuns } from './citation';

function normalizeMention(value: string) {
  return scientificRuns(formatScientificText(value))
    .map((run) => run.text)
    .join('')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[“”‘’"'「」『』《》]/g, '')
    .replace(/[‐‑–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Only titles explicitly written in the question may grant access to other papers.
export function matchLinkedPapers(
  question: string,
  papers: Paper[],
  currentId: string,
  shelves: Bookshelf[] = [],
) {
  const text = normalizeMention(question);
  const shelfMentions = [
    ...shelves.map(({ id, name }) => ({ id, name })),
    { id: null, name: '默认书架' },
  ]
    .flatMap(({ id, name }) => {
      const normalized = normalizeMention(name);
      if (!normalized) return [];
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const suffix = normalized.endsWith('书架') ? '' : '\\s*(?:书架|书柜|的|中|内|里)';
      const boundary = /^[a-z0-9]/.test(normalized) ? '(?<![a-z0-9])' : '';
      return [...text.matchAll(new RegExp(`${boundary}${escaped}${suffix}`, 'g'))].map((match) => ({
        id,
        start: match.index,
        end: match.index + match[0].length,
      }));
    })
    .sort((a, b) => b.end - a.end || a.start - b.start);
  const occurrences = papers.flatMap((paper) => {
    const title = normalizeMention(paper.title);
    if (paper.id === currentId || !title) return [];
    const matches: { paper: Paper; start: number; end: number; title: string }[] = [];
    let start = text.indexOf(title);
    while (start !== -1) {
      const end = start + title.length;
      // Avoid treating a short Latin title as a substring inside an unrelated word.
      const overlapsWord =
        (/[a-z0-9]/i.test(title[0]) && /[a-z0-9]/i.test(text[start - 1] || '')) ||
        (/[a-z0-9]/i.test(title[title.length - 1]) && /[a-z0-9]/i.test(text[end] || ''));
      if (!overlapsWord) matches.push({ paper, start, end, title });
      start = text.indexOf(title, start + title.length);
    }
    return matches;
  });
  const selected = occurrences.filter(
    (match) =>
      !occurrences.some(
        (other) =>
          other.title.length > match.title.length &&
          other.start <= match.start &&
          other.end >= match.end,
      ),
  );
  const titles = new Map<string, Set<string>>();
  let shelfMismatch = false;
  for (const item of selected) {
    const mention = shelfMentions.find(
      (shelf) =>
        shelf.end <= item.start &&
        item.start - shelf.end < 100 &&
        !/[。；;!?！？]/.test(text.slice(shelf.end, item.start)),
    );
    if (mention && (item.paper.shelfId || null) !== mention.id) {
      continue;
    }
    const key = `${item.start}:${item.end}:${item.title}`;
    const ids = titles.get(key) || new Set<string>();
    ids.add(item.paper.id);
    titles.set(key, ids);
  }
  for (const item of selected) {
    const key = `${item.start}:${item.end}:${item.title}`;
    if (!titles.has(key)) shelfMismatch = true;
  }
  const ambiguous = [...titles.values()].some((ids) => ids.size > 1);
  return {
    ids: [...new Set([...titles.values()].flatMap((ids) => [...ids]))],
    ambiguous,
    shelfMismatch,
    shelfMentioned: shelfMentions.length > 0,
    mentionedShelfIds: [...new Set(shelfMentions.map((item) => item.id))],
  };
}
