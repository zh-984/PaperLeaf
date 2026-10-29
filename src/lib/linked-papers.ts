import type { Paper } from './types';

// Only titles explicitly written in the question may grant access to other papers.
export function matchLinkedPapers(question: string, papers: Paper[], currentId: string) {
  const text = question.normalize('NFKC').toLocaleLowerCase();
  const occurrences = papers.flatMap((paper) => {
    const title = paper.title.trim().normalize('NFKC').toLocaleLowerCase();
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
  for (const item of selected) {
    const ids = titles.get(item.title) || new Set<string>();
    ids.add(item.paper.id);
    titles.set(item.title, ids);
  }
  const ambiguous = [...titles.values()].some((ids) => ids.size > 1);
  return { ids: [...new Set(selected.map((item) => item.paper.id))], ambiguous };
}
