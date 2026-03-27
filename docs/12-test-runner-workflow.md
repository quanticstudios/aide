# Test Runner Workflow

This repo uses multiple test entrypoints on purpose.

## Commands

- `bun test` or `bun run test:unit`
  - Runs the default Vitest suite that works cleanly under Bun.
  - Excludes `src/main/database.test.ts` because Bun does not provide `node:sqlite`.

- `bun run test:node`
  - Runs the full Vitest suite under Node.
  - Use this when touching SQLite-backed database code.

- `xvfb-run -a bun run test:e2e`
  - Runs the headless Electron Playwright suite.
  - Use this for desktop navigation behavior and Electron-only regressions.

## Expected usage

- Most UI or renderer work: `bun test`
- Database and persistence work: `bun run test:node`
- Desktop navigation and Electron work: `xvfb-run -a bun run test:e2e`

## Why this split exists

- Bun is fast and is the default package/script runner for the repo.
- Node is still required for `node:sqlite` tests.
- Playwright must stay isolated from the default unit runner.
