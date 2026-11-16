import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
// IPv4 on purpose: on some Windows machines, browser connections to the IPv6
// loopback that "localhost" resolves to occasionally stall.
const HOST = '127.0.0.1';
const CI = Boolean(process.env.CI);

// Locally the build goes to the system temp folder: serving files from a folder
// that a cloud sync client (such as OneDrive) is uploading can stall requests.
const OUT_DIR = CI ? 'dist' : path.join(os.tmpdir(), 'campus-rumor-mill-e2e');

/** End-to-end tests run against the production build, served locally. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A couple of workers at most: every test drives canvas animation and background workers.
  workers: 2,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://${HOST}:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: `npx tsc --noEmit && npx vite build --outDir "${OUT_DIR}" --emptyOutDir && npx vite preview --outDir "${OUT_DIR}" --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: !CI,
    timeout: 240_000,
  },
});
