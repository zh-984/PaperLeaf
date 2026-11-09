// Keep every input token. Overlap provides context; only newly covered tokens
// contribute weight, so overlap cannot dominate a long paragraph's score.
export function tokenWindows(tokens: number[]) {
  const windows: { ids: number[]; weight: number }[] = [];
  let covered = 0;
  for (let start = 0; start < tokens.length; start += 446) {
    const end = Math.min(start + 510, tokens.length);
    windows.push({ ids: [101, ...tokens.slice(start, end), 102], weight: end - covered });
    covered = end;
    if (end === tokens.length) break;
  }
  return windows;
}
