import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const { releaseInfo, isNewer, createUpdateChecker } = createRequire(import.meta.url)(
  '../desktop/updates.cjs',
);
const release = (version: string) => ({
  tag_name: `v${version}`,
  body: 'Actual release notes',
  assets: [{ name: `Paperleaf-Setup-${version}-x64.exe`, state: 'uploaded', size: 123 }],
});
it('offers new only for a newer complete stable release, never an equal/older/prerelease build', () => {
  expect(releaseInfo('0.9.3', release('0.9.3')).status).toBe('current');
  expect(releaseInfo('0.9.3', release('0.9.2')).status).toBe('current');
  expect(releaseInfo('0.9.3', release('0.10.0')).status).toBe('available');
  expect(isNewer('0.9.3-beta.1', '0.9.2')).toBe(false);
  expect(() => releaseInfo('0.9.3', { ...release('0.9.4'), prerelease: true })).toThrow();
  expect(() => releaseInfo('0.9.3', { ...release('0.9.4'), assets: [] })).toThrow();
});
it('shares in-flight requests and caches metadata without downloading installers, handles offline checks', async () => {
  let calls = 0;
  const check = createUpdateChecker({
    version: '0.9.3',
    fetch: async (url: string) => {
      expect(url).toBe('https://api.github.com/repos/zh-984/PaperLeaf/releases/latest');
      calls++;
      return { ok: true, text: async () => JSON.stringify(release('0.9.4')) };
    },
  });
  const results = await Promise.all([check(), check()]);
  expect(results.every((r) => r.status === 'available')).toBe(true);
  await check();
  expect(calls).toBe(1);
  const offline = createUpdateChecker({
    version: '0.9.3',
    fetch: async () => {
      throw new Error('fetch failed');
    },
  });
  expect((await offline()).status).toBe('error');
});
