// Browser tests (Chromium) against the built demo served by `vite preview`. Run: npm run test:browser
// QARI_CHROME_PATH=/path/to/chrome uses an installed Chrome instead of Playwright's Chromium.
import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.QARI_CHROME_PATH || undefined,
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: `npx vite build --config demo/vite.config.ts && npx vite preview --config demo/vite.config.ts --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
