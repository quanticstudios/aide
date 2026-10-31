import { defineConfig } from '@playwright/test'

// e2e/pitwall-daemon.ts serves this folder to the browser when the variable names it.
process.env.AIDE_E2E_WEB_BUNDLE ??= 'out/web'

/** The browser build on a phone-sized Chromium, against a pitwall daemon with fake providers (AIDE_E2E_PITWALL). */
export default defineConfig({
  globalSetup: './e2e/pitwall-daemon.ts',
  testDir: './e2e-web',
  fullyParallel: false,
  reporter: 'list',
  retries: 0,
  workers: 1,
  timeout: process.env.CI ? 60000 : 30000,
  use: {
    actionTimeout: 10000,
    browserName: 'chromium',
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    trace: 'retain-on-failure',
    viewport: { height: 844, width: 390 },
  },
})
