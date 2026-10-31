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
  - The Electron launch helper sets `AIDE_SOFTWARE_RENDERING=1` so headless CI
    uses the same explicit software fallback available to support.
  - Use this for desktop navigation behavior and Electron-only regressions.

- `AIDE_E2E_PITWALL=/path/to/pitwall xvfb-run -a bun run test:e2e`
  - Runs the same suite on the pitwall daemon backend, as CI's
    "Electron e2e on the pitwall daemon" job does.
  - `e2e/pitwall-daemon.ts` starts the daemon with `PITWALL_FAKE_PROVIDERS=1`
    in temp config, state and runtime folders, so it never meets your own
    daemon. The binary needs `PITWALL_FAKE_PROVIDERS` wired into the daemon
    (pitwall#241).
  - `e2e/daemon-backend-gaps.ts` lists the tests this run skips until the
    daemon backend reaches parity (ENG-2704).

## Linux software-rendering fallback

Linux desktop launches use hardware acceleration and Electron's GPU sandbox by
default. To collect a deterministic software-rendering diagnostic run, start
Aide with `AIDE_SOFTWARE_RENDERING=1` or pass `--aide-software-rendering`.
The runtime snapshot reports the selected rendering mode and its source.

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
