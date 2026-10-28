import type { Page } from '@playwright/test';
export async function openNotes(page: Page) {
  if (!(await page.locator('.side-panel').count()))
    await page.getByRole('button', { name: '打开追问面板', exact: true }).click();
  await page.locator('.side-panel').getByRole('button', { name: /^笔记/ }).click();
}
