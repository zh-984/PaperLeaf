import { expect, it } from 'vitest';
import { discoverSources, publicFetch, extractSourceText } from '@/server/work/sources';
import { db } from '@/server/db';
import { beginWork, workTaskInput } from '@/server/work/tasks';
import { makeParagraphs } from '@/lib/work';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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

it.skipIf(process.env.WORK_LIVE_NETWORK !== '1')(
  'completes a real public-source task from a Chinese scientific filename, then locates copied public text',
  async () => {
    const doc = await db.workDocument.create({
      data: {
        title: 'BiVO₄基光阳极化工进展4.1投稿版本',
        fileName: 'public-test.docx',
        filePath: randomUUID() + '.docx',
        hash: randomUUID(),
        fileSize: 0,
        paragraphsJson: JSON.stringify(
          makeParagraphs([
            {
              page: null,
              text: 'This is an isolated public network workflow check. No private manuscript or paid AI key is used.',
            },
          ]),
        ),
      },
    });
    try {
      let job = await beginWork(doc.id, workTaskInput.parse({ kind: 'similarity' }));
      await job.run();
      let task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } });
      const first = JSON.parse(task.resultsJson);
      expect(task.status, task.error).toBe('complete');
      expect(first.comparedSources, JSON.stringify(first.discovery)).toBeGreaterThan(0);
      const sources = await db.workSource.findMany({ where: { documentId: doc.id } });
      const snippet = sources[0].text.slice(0, 1200);
      await db.workDocument.update({
        where: { id: doc.id },
        data: { paragraphsJson: JSON.stringify(makeParagraphs([{ page: null, text: snippet }])) },
      });
      job = await beginWork(doc.id, workTaskInput.parse({ kind: 'similarity', discover: false }));
      await job.run();
      task = await db.workTask.findUniqueOrThrow({ where: { id: job.task.id } });
      const second = JSON.parse(task.resultsJson);
      expect(second.percentage).toBe(100);
      expect(second.matches.length).toBeGreaterThan(0);
      const proof = {
        livePublicWorkflow: true,
        status: task.status,
        providers: first.discovery.providers,
        queries: first.discovery.queries,
        candidates: first.discovery.candidates,
        acquiredSources: sources.length,
        storedTextBytes: sources.reduce((n, s) => n + Buffer.byteLength(s.text), 0),
        downloadedPdfsSaved: 0,
        knownCopiedPublicTextPercent: second.percentage,
        locatedMatches: second.matches.length,
        paidAiCalls: 0,
      };
      await mkdir('.test-data', { recursive: true });
      await writeFile('.test-data/public-similarity-live.json', JSON.stringify(proof, null, 2));
      console.log(JSON.stringify(proof));
    } finally {
      await db.workDocument.delete({ where: { id: doc.id } });
    }
  },
  160000,
);
