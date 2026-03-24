import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  retries: 0,
  timeout: 30000,
  use: {
    actionTimeout: 10000,
    trace: 'retain-on-failure',
  },
})
