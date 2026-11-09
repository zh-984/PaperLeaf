import { expect, it } from 'vitest';
import { tokenWindows } from '@/server/work/token-windows';
import { localDetectorState } from '@/server/work/local-detector';
it('normalizes BERT text and preserves complete long-text coverage with bounded windows', () => {
  const tokens = Array.from({ length: 1400 }, (_, i) => i + 200),
    windows = tokenWindows(tokens);
  expect(
    windows.every((w) => w.ids.length <= 512 && w.ids[0] === 101 && w.ids.at(-1) === 102),
  ).toBe(true);
  expect(windows.reduce((sum, w) => sum + w.weight, 0)).toBe(1400);
  expect(windows.at(-1)!.ids.at(-2)).toBe(tokens.at(-1));
  expect(localDetectorState().status).toBe('missing');
});
