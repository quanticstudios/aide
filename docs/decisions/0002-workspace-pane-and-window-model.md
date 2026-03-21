# ADR 0002: Workspace, Pane, and Window Model

- Status: Accepted
- Date: 2026-03-21
- Sources: `docs/01-product-decisions.md`, `docs/02-architecture.md`, `docs/07-execution-order.md`

## Context

The core product loop only works if the runtime model stays centered on workspaces instead of files, tabs, or windows.

## Decision

The top-level working unit is `Workspace`.

A workspace:

- owns its own layout
- owns its own panes
- owns its own jobs and notifications
- is typically backed by a git worktree
- is the object users open, switch, and return to

The structural model is:

```text
Project
  Workspace
    Layout
      Pane
```

Projects provide grouping and metadata, but they are not the live runtime container.

Pane layout uses a split tree with:

- horizontal split
- vertical split
- pane leaf

Navigation rules:

- left and right mean pane navigation only
- workspace switching uses dedicated controls and shortcuts
- project switching uses the sidebar, overview, and numeric jump hints

Window rule:

- a workspace may exist in only one window at a time

## Consequences

- Layout persistence and workspace selection state are foundational, not optional polish.
- Multi-window support must preserve single-window workspace ownership.
- Background jobs and notifications are scoped to workspaces, not to renderer windows.
