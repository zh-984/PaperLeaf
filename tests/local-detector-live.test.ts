import { expect, it } from 'vitest';
import { localDetectorState, startLocalInstall, localFindings } from '@/server/work/local-detector';
import { writeFile } from 'node:fs/promises';
import { db } from '@/server/db';
import { beginWork, workTaskInput } from '@/server/work/tasks';
it.skipIf(process.env.WORK_LOCAL_MODEL_TEST !== '1')(
  'downloads a pinned verified model and performs actual local CPU inference',
  async () => {
    const install = startLocalInstall();
    await install.run();
    const state = localDetectorState();
    expect(state.error).toBe('');
    expect(state.ready).toBe(true);
    const text =
      '本段为软件功能验证用的合成材料，不是正式发表的研究。实验记录中对样本条件、数据来源和测量方法进行了说明。对于不确定的信息，研究者应当补充原始记录并核实引用。中文检测模型给出的分数仅作为统计参考，不能证明某个人使用了何种写作工具。';
    const before = Date.now();
    const result = await localFindings(
      [
        { id: 'p1', text: text.repeat(5), page: null, heading: '正文' },
        { id: 'p2', text: '短标题', page: null, heading: '标题' },
      ],
      new AbortController().signal,
    );
    expect(result[0].score).toBeGreaterThanOrEqual(0);
    expect(result[0].score).toBeLessThanOrEqual(1);
    expect(result[1].risk).toBe('unknown');
    expect(result[1].score).toBeUndefined();
    const doc = await db.workDocument.create({
      data: {
        title: 'local-model-integration',
        fileName: 'synthetic.docx',
        filePath: 'synthetic-local-test.docx',
        fileSize: 1,
        hash: 'synthetic-local-test',
        paragraphsJson: JSON.stringify([
          { id: 'p1', text: text.repeat(5), page: null, heading: '正文' },
        ]),
      },
    });
    try {
      const task = await beginWork(doc.id, workTaskInput.parse({ kind: 'aigc', engine: 'local' }));
      await task.run();
      const saved = await db.workTask.findUniqueOrThrow({ where: { id: task.task.id } });
      expect(saved.status, saved.error).toBe('complete');
      expect(JSON.parse(saved.resultsJson).engine).toBe('local');
      expect(await db.workCache.count({ where: { documentId: doc.id } })).toBe(1);
      const second = await beginWork(
        doc.id,
        workTaskInput.parse({ kind: 'aigc', engine: 'local' }),
      );
      await second.run();
      expect(
        (await db.workTask.findUniqueOrThrow({ where: { id: second.task.id } })).resultsJson,
      ).toBe(saved.resultsJson);
    } finally {
      await db.workDocument.delete({ where: { id: doc.id } });
    }
    await writeFile(
      '.test-data/local-detector-live-result.json',
      JSON.stringify({
        realCPUInference: true,
        model: state.model,
        score: result[0].score,
        milliseconds: Date.now() - before,
        shortTextAbstained: true,
        actualTaskAndCachePassed: true,
        accuracyNotEvaluated: true,
      }),
    );
    console.log(
      JSON.stringify({
        realCPUInference: true,
        model: state.model,
        score: result[0].score,
        milliseconds: Date.now() - before,
        shortTextAbstained: true,
        accuracyNotEvaluated: true,
      }),
    );
  },
  360000,
);
