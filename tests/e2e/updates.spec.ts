import { expect, test } from '@playwright/test';
test('new is absent until a confirmed newer release, appears in both modes and opens update notes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.paperleafDesktop = {
      action: async () => {},
      word: async () => ({ citations: 0, references: 0 }),
      update: async () => ({
        status: 'available',
        currentVersion: '0.9.3',
        latestVersion: '9.0.0',
        notes: 'Synthetic update notice for browser verification.',
        url: 'https://github.com/zh-984/PaperLeaf/releases/tag/v9.0.0',
      }),
    };
  });
  await page.goto('http://127.0.0.1:3100');
  await expect(page.getByRole('button', { name: '查看可用更新' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看可用更新' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '查看可用更新' }).click();
  await expect(page.getByRole('dialog')).toContainText('发现新版 9.0.0');
  await expect(page.getByRole('dialog').getByRole('button', { name: '下载新版' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
  await page.getByRole('menuitemradio', { name: /PaperLeaf Work/ }).click();
  await expect(page.locator('.mode-pane[data-current="true"] .update-badge')).toBeVisible();
  await page.getByRole('button', { name: '切换 Read / Work 模式' }).click();
  await page.getByRole('menuitemradio', { name: /PaperLeaf Read/ }).click();
  await expect(page.locator('.mode-pane[data-current="true"] .project-shelf')).toBeVisible();
});
test('equal-version and failed checks never display new', async ({ page }) => {
  for (const status of ['current', 'error'] as const) {
    await page.addInitScript((status) => {
      window.paperleafDesktop = {
        action: async () => {},
        word: async () => ({ citations: 0, references: 0 }),
        update: async () => ({
          status,
          currentVersion: '0.9.3',
          latestVersion: status === 'current' ? '0.9.3' : '',
          notes: '',
          url: '',
        }),
      };
    }, status);
    await page.goto('http://127.0.0.1:3100');
    await page.waitForTimeout(8500);
    await expect(page.getByRole('button', { name: '查看可用更新' })).toHaveCount(0);
  }
});
