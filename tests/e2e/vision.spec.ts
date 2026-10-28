import { test, expect } from '@playwright/test';
import { makePdf } from '../fixtures';
const base = 'http://127.0.0.1:3101',
  mock = 'http://127.0.0.1:4123';
test('multimodal report reads every page image and reuses completed visual batches after failure', async ({
  request,
}) => {
  await request.patch(base + '/api/preferences', { data: { autoInterpret: true } });
  const settings = await (await request.get(`${base}/api/settings`)).json();
  await request.post(`${base}/api/settings`, {
    data: { baseUrl: settings.aiBaseUrl, model: 'GLM-5.3-Flash' },
  });
  try {
    await request.post(`${mock}/control`, { data: { failVisualAt: 2, delay: 10 } });
    const response = await request.post(`${base}/api/papers`, {
      multipart: {
        file: {
          name: 'visual-eight.pdf',
          mimeType: 'application/pdf',
          buffer: await makePdf('Visual Eight', 8),
        },
      },
    });
    expect(response.status()).toBe(201);
    const paper = await response.json();
    const detail = async () => (await request.get(`${base}/api/papers/${paper.id}`)).json();
    await expect.poll(async () => (await detail()).report.status).toBe('failed');
    const before = (await (await request.get(`${mock}/stats`)).json()).calls.filter(
      (call: { task: string }) => call.task === 'visual-summary',
    );
    expect(before).toHaveLength(2);
    expect(before[0].images).toBe(4);
    await request.post(`${base}/api/ai/report/${paper.id}`, { data: { force: false } });
    await expect
      .poll(async () => (await detail()).report.status, { timeout: 60000 })
      .toBe('complete');
    expect((await detail()).report.sections).toHaveLength(10);
    const after = (await (await request.get(`${mock}/stats`)).json()).calls.filter(
      (call: { task: string }) => call.task === 'visual-summary',
    );
    expect(after).toHaveLength(3);
    expect(after.filter((call: { hash: string }) => call.hash === before[0].hash)).toHaveLength(1);
    expect(
      after
        .filter((call: { failed: boolean }) => !call.failed)
        .reduce((sum: number, call: { images: number }) => sum + call.images, 0),
    ).toBe(8);
  } finally {
    await request.post(`${base}/api/settings`, {
      data: { baseUrl: settings.aiBaseUrl, model: settings.aiModel },
    });
  }
});
