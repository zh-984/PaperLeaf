import { expect, it } from 'vitest';
import { discoverSources, publicFetch, extractSourceText } from '@/server/work/sources';
it.skipIf(process.env.WORK_LIVE_NETWORK !== '1')(
  'retrieves actual open scholarly text without an AI API or private document',
  async () => {
    const found = await discoverSources('water splitting');
    expect(found.candidates.length).toBeGreaterThan(0);
    const candidates = found.candidates
      .filter((item) => item.scope.startsWith('Europe PMC'))
      .slice(0, 3);
    expect(candidates.length).toBeGreaterThan(0);
    let text: { title: string; text: string } | undefined;
    const failures: string[] = [];
    // A candidate can be temporarily unavailable despite appearing in search.
    // Match the application's bounded fallback instead of assuming the first
    // remote paper always has a working full-text endpoint.
    for (const candidate of candidates) {
      try {
        const page = await publicFetch(candidate.url);
        const parsed = extractSourceText(page.bytes, page.type);
        if (parsed.text.length <= 500) throw new Error('正文不足 500 字符');
        text = parsed;
        break;
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : '读取失败');
      }
    }
    expect(text, '至少取得一篇真实开放全文：' + failures.join('; ')).toBeDefined();
    if (!text) throw new Error('没有取得真实公开全文');
    expect(text.text.length).toBeGreaterThan(500);
    console.log(
      JSON.stringify({
        livePublicSource: true,
        title: text.title,
        characters: text.text.length,
        searchProvidersWithWarnings: found.warnings,
        unavailableCandidates: failures.length,
      }),
    );
  },
  90000,
);
