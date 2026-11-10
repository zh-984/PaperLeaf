import { expect, it } from 'vitest';
import { discoverSources, searchQueries, sourceError } from '@/server/work/discovery';
it('falls back from a Chinese manuscript filename to its scientific term, reports provider failures and supplies arXiv PDF fallback', async () => {
  expect(searchQueries('BiVO₄基光阳极化工进展4.1投稿版本.docx')).toEqual([
    'BiVO4基光阳极化工进展4.1投稿版本',
    'BiVO4',
  ]);
  const requested: string[] = [];
  const found = await discoverSources(
    'BiVO₄基光阳极化工进展4.1投稿版本.docx',
    undefined,
    async (url) => {
      requested.push(url);
      const u = new URL(url);
      if (u.hostname === 'api.openalex.org') throw new Error('来源返回 HTTP 429');
      let text: string;
      if (u.hostname === 'export.arxiv.org')
        text =
          '<feed><entry><id>http://arxiv.org/abs/2401.12345v2</id><title>Sample</title></entry></feed>';
      else
        text = JSON.stringify({
          resultList: {
            result: u.searchParams.get('query')?.includes('基光')
              ? []
              : [{ pmcid: 'PMC123', title: 'Scientific paper' }],
          },
        });
      return { bytes: Buffer.from(text), type: 'text/xml', url };
    },
  );
  expect(found.providers.find((p) => p.name === 'OpenAlex')).toMatchObject({
    status: 'error',
    message: '来源服务限流，请稍后重试',
  });
  expect(found.candidates.find((c) => c.scope.startsWith('arXiv'))?.alternatives).toEqual([
    'https://arxiv.org/pdf/2401.12345v2',
  ]);
  expect(found.candidates.some((c) => c.url.includes('PMC123/fullTextXML'))).toBe(true);
  expect(requested.filter((u) => u.includes('ebi.ac.uk'))).toHaveLength(2);
  expect(sourceError(new Error('ENOTFOUND api.example.org'))).toContain('解析');
});
it('does not present metadata-only OpenAlex results or empty responses as acquired full text', async () => {
  const found = await discoverSources('battery', undefined, async (url) => ({
    url,
    type: 'text/xml',
    bytes: Buffer.from(
      url.includes('openalex')
        ? '{"results":[{"title":"Metadata only","locations":[]}]}'
        : url.includes('arxiv')
          ? '<feed/>'
          : '{"resultList":{"result":[]}}',
    ),
  }));
  expect(found.candidates).toHaveLength(0);
  expect(found.providers.every((p) => p.status === 'empty')).toBe(true);
  expect(found.warnings).toHaveLength(3);
});
