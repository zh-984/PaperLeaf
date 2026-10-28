import { defineConfig } from '@playwright/test';
// All test traffic is loopback. Ignore machine-wide HTTP proxies for readiness checks.
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.ALL_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
process.env.NO_PROXY = '127.0.0.1,localhost';
delete process.env.NO_COLOR;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node tests/mock-ai.mjs',
      url: 'http://127.0.0.1:4123/stats',
      reuseExistingServer: false,
    },
    {
      command: 'node tests/start-app.mjs local',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'node tests/start-app.mjs ai',
      url: 'http://127.0.0.1:3101',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
