import { afterAll, describe, expect, it, vi } from 'vitest';
import { GET, PATCH } from '@/app/api/[...path]/route';
import { POST as recognize } from '@/app/api/ai/reference/[id]/route';
import { db } from '@/server/db';
import { defaultCitationSettings, formatCitation } from '@/lib/citation';
import type { ReferenceData } from '@/lib/types';

vi.mock('next/server', () => ({ after: () => undefined }));
const reference: ReferenceData = {
  type: 'journal',
  title: 'Test Article',
  authors: 'A; B',
  year: '2025',
  journal: 'Journal',
  volume: '',
  issue: '',
  pages: '',
  doi: '',
  publisher: '',
};
const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });
afterAll(async () => {
  await db.$disconnect();
});

describe('citation information and formatting', () => {
  it('formats custom labels and omits empty brackets', () => {
    expect(formatCitation('({{number}})', reference, 2)).toBe('(2)');
    expect(formatCitation(defaultCitationSettings.referenceTemplate, reference, 1)).toContain(
      '[1] A; B. Test Article[J]. Journal, 2025',
    );
    expect(formatCitation(defaultCitationSettings.referenceTemplate, reference, 1)).not.toContain(
      '()',
    );
  });
  it('saves metadata and styles atomically, requires explicit AI configuration and cascades on deletion', async () => {
    const paper = await db.paper.create({
      data: {
        title: 'Original',
        filePath: 'test-citation.pdf',
        fileName: 'test.pdf',
        fileSize: 10,
        pageCount: 1,
      },
    });
    try {
      const initial = await GET(
        new Request(`http://localhost/api/papers/${paper.id}/reference`),
        context('papers', paper.id, 'reference'),
      );
      expect((await initial.json()).title).toBe('Original');
      const endpoint = `http://localhost/api/papers/${paper.id}/reference`;
      const valid = await PATCH(
        new Request(endpoint, {
          method: 'PATCH',
          body: JSON.stringify({ reference, settings: defaultCitationSettings }),
        }),
        context('papers', paper.id, 'reference'),
      );
      expect(valid.status).toBe(200);
      const invalid = await PATCH(
        new Request(endpoint, {
          method: 'PATCH',
          body: JSON.stringify({
            reference: { ...reference, title: 'Should not persist' },
            settings: { ...defaultCitationSettings, markerTemplate: 'invalid' },
          }),
        }),
        context('papers', paper.id, 'reference'),
      );
      expect(invalid.status).toBe(400);
      expect((await db.reference.findUniqueOrThrow({ where: { paperId: paper.id } })).title).toBe(
        'Test Article',
      );
      const response = await recognize(
        new Request('http://localhost/api/ai/reference/' + paper.id, { method: 'POST' }),
        { params: Promise.resolve({ id: paper.id }) },
      );
      expect(response.status).toBe(503);
    } finally {
      await db.paper.delete({ where: { id: paper.id } });
    }
    expect(await db.reference.findUnique({ where: { paperId: paper.id } })).toBeNull();
  });
});
