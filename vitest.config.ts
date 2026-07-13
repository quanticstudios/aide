import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['e2e/**'],
    include: ['scripts/**/*.test.mjs', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
