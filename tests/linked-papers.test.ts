import { describe, expect, it } from 'vitest';
import { matchLinkedPapers } from '@/lib/linked-papers';
import type { Bookshelf, Paper } from '@/lib/types';

const paper = (id: string, title: string) => ({ id, title }) as Paper;

describe('explicit bookshelf title matching', () => {
  it('matches complete titles case-insensitively, excludes the current paper and ignores unknown titles', () => {
    const papers = [
      paper('current', 'Current'),
      paper('one', 'Linked Reference'),
      paper('two', '另一个标题'),
    ];
    expect(
      matchLinkedPapers('对比 current、linked reference 和另一个标题', papers, 'current'),
    ).toEqual({
      ids: ['one', 'two'],
      ambiguous: false,
      shelfMismatch: false,
      shelfMentioned: false,
      mentionedShelfIds: [],
    });
    expect(matchLinkedPapers('对比 Linked 与不存在的文献', papers, 'current').ids).toEqual([]);
    expect(matchLinkedPapers('explain this', [paper('ai', 'AI')], 'current').ids).toEqual([]);
    expect(matchLinkedPapers('解释AI模型', [paper('ai', 'AI')], 'current').ids).toEqual(['ai']);
  });
  it('resolves identical titles by their specified shelf and rejects mismatched shelves', () => {
    const shelves = [
      { id: 's1', name: '111' },
      { id: 's2', name: '222' },
    ] as Bookshelf[];
    const papers = [
      { ...paper('one', '相同标题'), shelfId: 's1' },
      { ...paper('two', '相同标题'), shelfId: 's2' },
      { ...paper('three', '独有文献'), shelfId: 's2' },
    ];
    expect(matchLinkedPapers('111书架的相同标题', papers, 'current', shelves)).toEqual({
      ids: ['one'],
      ambiguous: false,
      shelfMismatch: false,
      shelfMentioned: true,
      mentionedShelfIds: ['s1'],
    });
    expect(
      matchLinkedPapers('111书架的相同标题和222书架的相同标题', papers, 'current', shelves).ids,
    ).toEqual(['one', 'two']);
    expect(matchLinkedPapers('111书架的独有文献', papers, 'current', shelves).shelfMismatch).toBe(
      true,
    );
    expect(matchLinkedPapers('相同标题', papers, 'current', shelves).ambiguous).toBe(true);
  });
  it('prefers a longer overlapping title and rejects duplicate full titles', () => {
    const papers = [paper('one', 'Study'), paper('two', 'Study of Water')];
    expect(matchLinkedPapers('比较 Study of Water', papers, 'current').ids).toEqual(['two']);
    expect(matchLinkedPapers('Study of Water 与 Study', papers, 'current').ids).toEqual([
      'one',
      'two',
    ]);
    expect(
      matchLinkedPapers('Study of Water', [...papers, paper('three', 'Study of Water')], 'current')
        .ambiguous,
    ).toBe(true);
  });
});
