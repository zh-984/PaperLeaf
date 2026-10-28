import { expect, it } from 'vitest';
import { numberedNotes } from '@/lib/note-order';
import type { Note } from '@/lib/types';
it('numbers notes by paper position regardless of creation order and renumbers after deletion', () => {
  const note = (id: string, page: number, y: number): Note => ({
    id,
    paperId: 'paper',
    page,
    selectedText: 'original',
    content: id,
    source: 'manual',
    version: 0,
    createdAt: '2026-10-27T00:00:00Z',
    updatedAt: '2026-10-27T00:00:00Z',
    anchor: { version: 1, locations: [{ page, rects: [[0.1, y, 0.2, 0.02]] }] },
  });
  const notes = [
    note('first-created-lower', 2, 0.7),
    note('last-page', 4, 0.1),
    note('second-created-upper', 2, 0.1),
  ];
  expect(numberedNotes(notes).map(({ note, number }) => [note.id, number])).toEqual([
    ['second-created-upper', 1],
    ['first-created-lower', 2],
    ['last-page', 3],
  ]);
  expect(numberedNotes(notes.slice(0, 2)).map(({ number }) => number)).toEqual([1, 2]);
});
