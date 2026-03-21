# AI-Native Coding Shell — Build Plan

This folder contains a build plan for a cross-platform, Electron-based coding shell focused on AI-assisted work orchestration rather than traditional editor-first development.

## What this package contains

1. [`docs/01-product-decisions.md`](./docs/01-product-decisions.md) — fixed product decisions from discovery
2. [`docs/02-architecture.md`](./docs/02-architecture.md) — system design, data model, module boundaries
3. [`docs/03-roadmap-phases.md`](./docs/03-roadmap-phases.md) — phased delivery plan, milestones, rough estimates
4. [`docs/04-ticket-backlog-foundations.md`](./docs/04-ticket-backlog-foundations.md) — phases 0–2 tickets
5. [`docs/05-ticket-backlog-core-panes-and-ai.md`](./docs/05-ticket-backlog-core-panes-and-ai.md) — phases 3–4 tickets
6. [`docs/06-ticket-backlog-notifications-multiwindow.md`](./docs/06-ticket-backlog-notifications-multiwindow.md) — phases 5–6 tickets
7. [`docs/07-execution-order.md`](./docs/07-execution-order.md) — strict order of execution, dependencies, critical path
8. [`docs/08-risks-cuts-open-questions.md`](./docs/08-risks-cuts-open-questions.md) — risk register, cut lines, things to defer
9. [`docs/09-beads-execution-plan.md`](./docs/09-beads-execution-plan.md) — execution plan for beads, Bun, Vite, React Doctor, and Biome
10. [`docs/decisions/README.md`](./docs/decisions/README.md) — accepted decision log and locked scope docs

## Product summary

The product is:

- an **AI-native coding shell**
- **cross-platform**
- **Electron-first**
- **workspace-first**
- **pane-oriented**
- optimized for:
  - chat
  - terminal
  - git
  - preview
  - jobs/notifications
  - light editor use

It is **not**:

- a full browser
- a full traditional IDE
- a window manager
- a VS Code replacement on day one
- a TUI wrapper

## Core user-facing model

```text
Project
  Workspace
    Layout
      Pane
```

Notes:

- `Project` is grouping and metadata.
- `Workspace` is the first-class working unit.
- A workspace is typically backed by a Git worktree.
- A workspace can exist in **only one window at a time**.
- Notifications target the **workspace level**.
- `Layout` is a split tree.
- `Pane` is a typed tool surface: chat, terminal, git, preview, editor, logs, jobs.

## Core product constraints

- Use battle-tested components wherever possible.
- Do not build a custom editor engine.
- Do not build a custom terminal engine.
- Do not build a full browser.
- Keep preview limited to app/runtime surfaces.
- Build the differentiation in:
  - workspace model
  - pane layout
  - navigation
  - job orchestration
  - notification UX
  - provider adapter layer

## Suggested reading order

1. Product decisions
2. Architecture
3. Roadmap phases
4. Ticket backlogs
5. Execution order
6. Risks and cut lines
