# Beads Execution Plan

## Goal

Turn the existing product docs into an executable beads backlog for an Electron-first coding shell using React, TypeScript, Bun, and Vite.

## Locked decisions for implementation

- Keep the product workspace-first, pane-oriented, and Electron-first.
- Use React + TypeScript for the renderer.
- Use Bun for package management and scripts.
- Use Vite-based tooling for the renderer build and dev flow.
- Set up Biome early so every implementation ticket has a consistent quality gate.
- Run `npx -y react-doctor@latest .` and Biome after each meaningful change inside a ticket.
- Make one focused git commit per completed ticket.

## Recommended stack

- Electron
- React
- TypeScript
- Bun
- Vite
- Biome
- Monaco
- xterm.js
- SQLite
- Zustand

## Beads board setup

The repo does not have a beads database yet, so start by initializing one:

```bash
bd init --prefix aide
```

Then seed the board in two layers:

1. Create one epic per phase from the roadmap.
2. Create child task tickets from the backlog docs with dependencies matching `docs/07-execution-order.md`.

Recommended epics:

- Phase 0 - Spec freeze and spikes
- Phase 1 - App skeleton and workspace domain
- Phase 2 - Layout, navigation, sidebar, overview shell
- Phase 3 - Core panes
- Phase 4 - Chat and provider adapter layer
- Phase 5 - Notifications and workflow polish
- Phase 6 - Multi-window and usability pass

## Seeding priority

Seed the alpha path first, not the full long-tail backlog.

Create these first:

- All Phase 0 tickets
- All Phase 1 tickets
- All Phase 2 tickets
- Phase 3 tickets through `P3-012`
- Phase 4 tickets through `P4-010`, plus `P4-013` and `P4-014`
- Phase 5 tickets through `P5-005`

Defer these until the core loop is real:

- `P4-011` Codex adapter
- `P4-012` OpenCode adapter
- `P5-006` and later polish items
- All Phase 6 work

## Important adjustment for this repo

The current repository is docs-only, so `P0-002` should include the initial app scaffold:

- Electron + React + TypeScript bootstrap
- Bun package setup
- Vite renderer setup
- Biome config
- basic `bun run dev` and `bun run build` scripts

This keeps the actual implementation aligned with the product docs while accounting for the current starting point.

## Ticket workflow

For each ticket:

```bash
bd ready
bd update <id> --status in_progress
```

Implement the ticket, then run the verification loop:

```bash
npx -y react-doctor@latest .
bunx @biomejs/biome check .
```

As soon as app scripts exist, also run the relevant project command for the ticket, for example:

```bash
bun test
bun run build
```

Then commit and close the ticket:

```bash
git add .
git commit -m "feat: complete <ticket-id> <short-scope>"
bd close <id>
```

## Commit rule

- One commit per finished ticket
- Use conventional commits
- Include the ticket ID in the commit message when practical
- Do not batch unrelated tickets into one commit

## Suggested labels

- `phase:0` through `phase:6`
- `area:shell`
- `area:workspace`
- `area:layout`
- `area:sidebar`
- `area:terminal`
- `area:git`
- `area:preview`
- `area:editor`
- `area:jobs`
- `area:chat`
- `area:provider`
- `area:notifications`
- `area:windowing`

## First beads to create

Recommended first sequence:

1. `P0-001 Create decision log and scope file`
2. `P0-002 Electron shell spike with Bun and Vite scaffold`
3. `P0-003 Monaco pane spike`
4. `P0-004 xterm.js + PTY spike`
5. `P0-005 Preview spike`
6. `P0-006 Persistence spike`
7. `P0-007 CLI executable resolution spike`
8. `P0-008 Domain schema draft`

Only after those pass should the board move into Phase 1 app-shell and workspace work.

## Source of truth

Use these docs as the canonical backlog source:

- `README.md`
- `docs/01-product-decisions.md`
- `docs/02-architecture.md`
- `docs/03-roadmap-phases.md`
- `docs/04-ticket-backlog-foundations.md`
- `docs/05-ticket-backlog-core-panes-and-ai.md`
- `docs/06-ticket-backlog-notifications-multiwindow.md`
- `docs/07-execution-order.md`
- `docs/08-risks-cuts-open-questions.md`
