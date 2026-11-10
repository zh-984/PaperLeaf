// Metadata-only checks. Installers are downloaded by the user's browser, never silently executed.
const RELEASES = 'https://github.com/zh-984/PaperLeaf/releases';
function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value || '');
  return match ? match.slice(1).map(Number) : null;
}
function isNewer(candidate, current) {
  const a = versionParts(candidate),
    b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function releaseInfo(currentVersion, release) {
  if (release.draft || release.prerelease || !versionParts(release.tag_name))
    throw new Error('发布信息无效');
  const latestVersion = release.tag_name.replace(/^v/, '');
  const installer = `Paperleaf-Setup-${latestVersion}-x64.exe`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (!assets.some((a) => a.name === installer && a.state === 'uploaded' && a.size > 0))
    throw new Error('新版安装包尚未发布完成');
  return {
    status: isNewer(latestVersion, currentVersion) ? 'available' : 'current',
    currentVersion,
    latestVersion,
    notes: typeof release.body === 'string' ? release.body.slice(0, 6000) : '',
    url: `${RELEASES}/tag/${encodeURIComponent(release.tag_name)}`,
  };
}
function createUpdateChecker({ version, fetch, now = Date.now }) {
  let cached,
    checked = 0,
    pending;
  return async function check(force = false) {
    if (pending) return pending;
    if (!force && cached && now() - checked < (cached.status === 'error' ? 120000 : 86400000))
      return cached;
    pending = (async () => {
      try {
        const response = await fetch(
          'https://api.github.com/repos/zh-984/PaperLeaf/releases/latest',
          {
            headers: {
              Accept: 'application/vnd.github+json',
              'User-Agent': 'Paperleaf-update-check',
            },
            signal: AbortSignal.timeout(12000),
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 403 || response.status === 429
              ? 'GitHub 请求受限，请稍后再试'
              : `更新服务返回 HTTP ${response.status}`,
          );
        const text = await response.text();
        if (text.length > 1024 * 1024) throw new Error('更新信息过大');
        cached = releaseInfo(version, JSON.parse(text));
      } catch (error) {
        cached = {
          status: 'error',
          currentVersion: version,
          latestVersion: '',
          notes: '',
          url: RELEASES,
          error: /HTTP|GitHub|发布|更新/.test(error.message || '')
            ? error.message
            : '暂时无法连接 GitHub，请检查网络或稍后重试',
        };
      }
      checked = now();
      return cached;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
module.exports = { createUpdateChecker, releaseInfo, isNewer, RELEASES };
