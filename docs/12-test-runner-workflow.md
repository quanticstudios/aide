# Test Runner Workflow

This repo uses multiple test entrypoints on purpose.

## Commands

- `bun run test`
  - Runs the full Vitest suite under Node, including SQLite-backed tests.
  - This is the authoritative default unit/integration gate.

- `bun test`
  - Runs the fast Bun-compatible subset.
  - `bunfig.toml` excludes Playwright and the database/Git integration tests
    because Bun does not provide `node:sqlite`.

- `bun run test:node`
  - Runs the full Vitest suite under Node.
  - Use this when touching SQLite-backed database code.

- `xvfb-run -a bun run test:e2e`
  - Runs the headless Electron Playwright suite.
  - Use this for desktop navigation behavior and Electron-only regressions.

## Expected usage

- Before every completed change: `bun run test`
- During fast UI or renderer iteration: `bun test`
- Database and persistence work: `bun run test:node`
- Desktop navigation and Electron work: `xvfb-run -a bun run test:e2e`

## Why this split exists

- Bun is fast for the compatible unit subset.
- Vitest under Node is the authoritative gate because Node provides
  `node:sqlite` and the full Vitest API.
- Playwright must stay isolated from the default unit runner.
