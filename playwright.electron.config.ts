import { defineConfig } from '@playwright/test'

export default defineConfig({
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
