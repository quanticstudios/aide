import { defineConfig } from '@playwright/test'
import { DAEMON_BACKEND_GAPS } from './e2e/daemon-backend-gaps'

export default defineConfig({
  globalSetup: './e2e/pitwall-daemon.ts',
  grepInvert: process.env.AIDE_E2E_PITWALL
    ? new RegExp(
        DAEMON_BACKEND_GAPS.map(([title]) =>
          title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        ).join('|'),
      )
    : undefined,
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  retries: 0,
  workers: 1,
  timeout: process.env.CI ? 60000 : 30000,
  use: {
    actionTimeout: 10000,
    trace: 'retain-on-failure',
  },
})
