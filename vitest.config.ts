import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src/renderer/src') },
  },
  test: {
    environment: 'node',
    exclude: ['e2e/**'],
    include: ['scripts/**/*.test.mjs', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
