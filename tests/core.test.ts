import { describe, expect, it } from 'vitest';
import { splitPages, verifyEvidence } from '@/lib/chunks';
import { parseByteRange } from '@/lib/range';
import { askSchema, notePatchSchema, paperPatchSchema } from '@/lib/validation';
import { safeFilePath, validatePdfUpload } from '@/server/storage';

describe('PDF evidence and long document chunking', () => {
  it('preserves text across chunk boundaries and keeps every chunk within budget', () => {
    const text = 'abcdefghijk'.repeat(1000);
    const chunks = splitPages([{ page: 7, text }], 600);
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.every((chunk) => chunk.length <= 600)).toBe(true);
    expect(
      chunks
        .join('')
        .replace(/\[p\.7\] /g, '')
        .replace(/\n/g, ''),
    ).toBe(text);
  });
  it('retains actual PDF page markers', () => {
    expect(
      splitPages(
        [
          { page: 5, text: 'Methods' },
          { page: 9, text: 'Results' },
        ],
        500,
      )[0],
    ).toContain('[p.9] Results');
  });
  it('verifies quotes despite spacing and Unicode differences', () => {
    expect(
      verifyEvidence({ text: 'test', page: 2, quote: 'Ａ controlled experiment' }, [
        { page: 2, text: 'A  controlled\nexperiment' },
      ]).verified,
    ).toBe(true);
  });
  it('never marks fabricated quotes as verified', () => {
    const result = verifyEvidence({ text: 'test', page: 2, quote: 'Invented data' }, [
      { page: 2, text: 'Actual data' },
    ]);
    expect(result.verified).toBe(false);
    expect(result.quote).toBe('');
  });
  it('removes out of range page references', () => {
    expect(
      verifyEvidence({ text: 'test', page: 999, quote: 'Actual data' }, [
        { page: 1, text: 'Actual data' },
      ]).page,
    ).toBeNull();
  });
});
describe('byte ranges', () => {
  it.each([
    ['bytes=0-4', { start: 0, end: 4 }],
    ['bytes=90-', { start: 90, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=0-999', { start: 0, end: 99 }],
  ])('parses %s', (input, expected) => {
    expect(parseByteRange(input, 100)).toEqual(expected);
  });
  it.each(['bytes=100-', 'bytes=8-2', 'bytes=-0', 'bytes=0-2,4-6', 'bytes=-', 'invalid'])(
    'rejects %s',
    (value) => {
      expect(parseByteRange(value, 100)).toBeNull();
    },
  );
});
describe('input boundaries', () => {
  it.each(['../../secret.pdf', 'C:/secret.pdf', 'abc.pdf', '%2e%2e.pdf'])(
    'rejects unsafe paths %s',
    (value) => {
      expect(() => safeFilePath(value)).toThrow();
    },
  );
  it('validates extension, MIME, signature, empty file and size', () => {
    const bytes = Buffer.from('%PDF-1.7');
    expect(() => validatePdfUpload('paper.PDF', 'application/pdf', 8, bytes)).not.toThrow();
    expect(() =>
      validatePdfUpload('paper.pdf', 'application/octet-stream', 8, bytes),
    ).not.toThrow();
    expect(() => validatePdfUpload('paper.exe', 'application/pdf', 8, bytes)).toThrow();
    expect(() => validatePdfUpload('paper.pdf', 'text/html', 8, bytes)).toThrow();
    expect(() => validatePdfUpload('paper.pdf', 'application/pdf', 0, bytes)).toThrow();
    expect(() =>
      validatePdfUpload('paper.pdf', 'application/pdf', 60 * 1024 * 1024, bytes),
    ).toThrow();
    expect(() =>
      validatePdfUpload('paper.pdf', 'application/pdf', 8, Buffer.from('<script>')),
    ).toThrow();
  });
  it('rejects empty titles, negative pages and non-versioned note updates', () => {
    expect(paperPatchSchema.safeParse({ title: ' ' }).success).toBe(false);
    expect(paperPatchSchema.safeParse({ lastPage: -1 }).success).toBe(false);
    expect(notePatchSchema.safeParse({ content: 'note' }).success).toBe(false);
  });
  it('requires a selection or a question for AI actions', () => {
    expect(askSchema.safeParse({ action: 'question', page: 1 }).success).toBe(false);
    expect(askSchema.safeParse({ action: 'translate', page: 1 }).success).toBe(false);
    expect(askSchema.safeParse({ action: 'question', page: 1, question: '为什么？' }).success).toBe(
      true,
    );
  });
});
