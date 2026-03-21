# ADR 0003: Implementation Baseline

- Status: Accepted
- Date: 2026-03-21
- Sources: `docs/02-architecture.md`, `docs/09-beads-execution-plan.md`

## Context

The original product docs left some implementation choices flexible. Before scaffolding begins, the repo needs a clear baseline for the first working app shell.

## Decision

The implementation baseline is:

- Electron for the desktop shell
- React and TypeScript for the renderer
- Bun for package management and script execution
- Vite for renderer build and dev workflow
- Biome for formatting and linting

Planned supporting tools:

- Monaco for the editor surface
- xterm.js plus a PTY bridge for terminal
- SQLite for durable app state
- Zustand for shared client state unless implementation proves a simpler option is better

Quality gate expectations for implementation tickets:

- run `npx -y react-doctor@latest .` after meaningful code changes
- run `bunx @biomejs/biome check .` after meaningful code changes
- run the relevant build or test command once the scaffold exists
- make one focused commit per completed ticket

## Consequences

- `P0-002` must create a Bun and Vite based Electron scaffold rather than a generic npm-based starter.
- Tooling and scripts should prefer Bun-first commands unless a dependency requires another runner.
- Code quality checks become part of the definition of done for each implementation bead.
