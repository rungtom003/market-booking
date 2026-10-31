import { defineConfig, devices } from '@playwright/test';
import { ADMIN_PORT, ADMIN_URL, API_PORT, ROOT, WEB_PORT, WEB_URL, apiEnv } from './env';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: WEB_URL,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // แอปผู้ค้า — เป้าหมาย Overview §13: ใช้งานได้ดีที่ความกว้าง 360px
      name: 'vendor-mobile-360',
      testMatch: /(registration|market-map|round-countdown)\.spec\.ts/,
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } },
    },
    {
      // แอป admin — desktop-first
      name: 'admin-desktop',
      testMatch: /admin(-market|-rounds)?\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      // build ก่อนรัน (root script `test:e2e`) — ใช้ไฟล์ build จริง ไม่ใช่ watch mode
      command: 'node dist/main.js',
      cwd: `${ROOT}/apps/api`,
      url: `http://localhost:${API_PORT}/api/v1/health`,
      env: apiEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec vite',
      cwd: `${ROOT}/apps/web`,
      url: WEB_URL,
      env: { WEB_PORT: String(WEB_PORT), VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec vite',
      cwd: `${ROOT}/apps/admin`,
      url: ADMIN_URL,
      env: {
        ADMIN_PORT: String(ADMIN_PORT),
        VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
