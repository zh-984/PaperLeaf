import { describe, expect, it } from 'vitest';
import { cleanAnswerText } from '@/lib/answer-text';

describe('AI answer display cleanup', () => {
  it('removes presentation markup while retaining scientific notation and meaning', () => {
    expect(
      cleanAnswerText('## 结论\n1. **Word 引用联动（p.3）**：内容\n* 保留 x*y\n- `术语`'),
    ).toBe('结论\n1. Word 引用联动（p.3）：内容\n保留 x*y\n术语');
    expect(cleanAnswerText('这是 *重要* 的结论。[资料](https://example.com)')).toBe(
      '这是 重要 的结论。资料（https://example.com）',
    );
  });
});
