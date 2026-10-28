import type { Note } from './types';

export function notePosition(note: Note): [number, number, number] {
  const positions = note.anchor?.locations.map((location): [number, number, number] => [
    location.page,
    location.rects.length
      ? Math.min(...location.rects.map((rect) => rect[1]))
      : (location.position ?? 1),
    location.rects.length ? Math.min(...location.rects.map((rect) => rect[0])) : 0,
  ]);
  return (
    positions?.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])[0] || [
      note.page ?? Infinity,
      1,
      0,
    ]
  );
}
export function numberedNotes(notes: Note[]) {
  return [...notes]
    .sort((a, b) => {
      const left = notePosition(a),
        right = notePosition(b);
      return (
        left[0] - right[0] ||
        left[1] - right[1] ||
        left[2] - right[2] ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
      );
    })
    .map((note, index) => ({ note, number: index + 1 }));
}
