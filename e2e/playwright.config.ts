import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:1420',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    cwd: path.resolve(__dirname, '..'),
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
