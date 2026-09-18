# Architecture and Core Data Model

## 1. Architecture summary

This product should be built as an Electron desktop application with a clear split between:

- **Desktop shell / process orchestration**
- **Shared domain state**
- **Workspace runtime services**
- **Pane rendering layer**
- **Provider adapter layer**

## 2. Proposed technology choices

### Desktop shell
- Electron
- electron-builder or Electron Forge for packaging

### UI
- React or Solid
- TypeScript
- state management via Zustand / Jotai / Redux Toolkit (pick one and keep it boring)
- CSS system via Tailwind or plain CSS modules

### Editor
- Monaco

### Terminal
- xterm.js
- PTY bridge using Node child processes and platform-safe shell launching

### Storage
- SQLite for durable app state
- lightweight file-based config layer for export/import if needed later

### Git
- Git CLI wrapping
- parseable output wherever possible

### Preview
- embedded preview surface for local app/runtime URLs only

### AI backends
- provider adapter interface
- Claude Code adapter first
- Codex CLI second
- OpenCode third

## 3. Core entity model

```text
Project
  Workspace
    Layout
      Pane
```

Supporting entities:

- Job
- Notification
- ProviderSession
- ProcessHandle
- PreviewTarget
- GitState
- PaneViewState

## 4. Entity responsibilities

### Project

Project is metadata and grouping.

A project opens a folder. Git repositories expose Git panes and worktrees;
ordinary folders use one root workspace with the other pane types.

Fields:

- `id`
- `name`
- `repoRoot`
- `kind: git | folder`
- `remoteUrl`
- `defaultBranch`
- `workspaceIds[]`
- `settings`
- `createdAt`
- `updatedAt`

Responsibilities:

- sidebar grouping
- overview grouping
- workspace creation source
- project-level settings defaults

### Workspace

Workspace is the first-class working unit.

Fields:

- `id`
- `projectId`
- `name`
- `branchName`
- `worktreePath`
- `windowId | null`
- `layoutRootId`
- `activePaneId`
- `status`
- `previewTargets[]`
- `providerConfig`
- `pinned`
- `createdAt`
- `updatedAt`

Responsibilities:

- owns panes and layout
- owns jobs
- owns notification target path
- owns runtime services
- owns chat scope
- owns terminal scope
- owns preview scope

### Layout

Layout is a split tree.

Node types:

- `split-horizontal`
- `split-vertical`
- `pane`

Layout node fields:

- `id`
- `workspaceId`
- `type`
- `parentId | null`
- `children[]`
- `sizeWeights[]`
- `paneId | null`

Responsibilities:

- deterministic pane arrangement
- persisted workspace structure
- split/merge/close operations
- focus traversal rules

### Pane

Pane is a typed tool surface.

Pane types:

- `chat`
- `terminal`
- `git`
- `preview`
- `editor`
- `logs`
- `jobs`

Base fields:

- `id`
- `workspaceId`
- `type`
- `title`
- `state`
- `createdAt`
- `updatedAt`

Pane-specific state examples:

- chat: provider, thread state, prompt history, pending task id
- terminal: cwd, shell, scrollback ref, process session id
- git: selected diff target, staged filter, compare mode
- preview: target URL, reload policy, devtools flag
- editor: file path, cursor pos, view mode, diff mode
- logs: source ref, filters
- jobs: selected job, queue filter

### Job

Job is a long-running or background action associated with a workspace.

Types:

- provider task
- command execution
- test run
- build
- preview start
- git operation

Fields:

- `id`
- `workspaceId`
- `source`
- `type`
- `status`
- `summary`
- `detailsRef`
- `startedAt`
- `endedAt`
- `result`

### Notification

Notification is a user-facing signal bound to a workspace and optionally a job/pane.

Fields:

- `id`
- `workspaceId`
- `projectId`
- `jobId | null`
- `severity`
- `title`
- `body`
- `actionTarget`
- `read`
- `createdAt`

## 5. Window model

### Rules

- a workspace can exist in only one window at a time
- a window may host one or more workspaces
- multi-window comes later, but state model must support it now
- workspace runtime services must not be tightly coupled to a single renderer

### Required implications

- `windowId` belongs on workspace state
- notifications are workspace-scoped, not window-scoped
- background jobs continue even if a renderer for that workspace is closed, unless explicitly stopped

## 6. Navigation model

### Principles

- left/right only means pane navigation
- projects are switched via sidebar, hints, overview
- workspaces are switched via sidebar, overview, and dedicated shortcuts
- the header toggle opens or fully hides the sidebar

### Candidate shortcut model

- `Alt + Left/Right`: focus neighboring pane
- `Alt + Up/Down`: previous/next workspace in current project
- `Ctrl` hold: show numeric project hints
- `Ctrl + [digit]`: direct jump to project
- `Cmd/Ctrl + Tab`: overview / workspace switcher

## 7. Pane composition model

Each workspace owns a split tree.

Example:

```text
Workspace
  Split(horizontal)
    Pane(chat)
    Split(vertical)
      Pane(terminal)
      Pane(git)
```

Example 2:

```text
Workspace
  Split(vertical)
    Split(horizontal)
      Pane(editor)
      Pane(preview)
    Pane(jobs)
```

## 8. Pane-local tabs / stacks

This should not be phase-1 architecture.

Recommended approach:

- keep pane nodes single-view first
- add optional local stacks after base layout is stable

If implemented later, model it as:

- PaneGroup
  - active child pane
  - local tab strip

Do not let it become the primary structure.

## 9. Runtime services by workspace

Workspace should own the following runtime service containers:

### Terminal service
- PTY sessions
- shell info
- cwd
- scrollback persistence strategy

### Preview service
- known preview targets
- active preview health
- reload hooks

### Job service
- queued/running/completed job registry
- retry/cancel surface
- completion events

### Provider session service
- active AI provider
- current task streams
- adapter-specific metadata

### Git service
- branch info
- changed files
- staged/unstaged
- diff data

## 10. Provider adapter contract

The chat pane should not talk directly to provider-specific CLI logic.

Create an interface like:

```ts
interface ProviderAdapter {
  id: string
  startTask(input: StartTaskInput): Promise<TaskHandle>
  cancelTask(taskId: string): Promise<void>
  subscribe(taskId: string, onEvent: (event: ProviderEvent) => void): Unsubscribe
  getCapabilities(): ProviderCapabilities
  validateSetup(): Promise<ValidationResult>
}
```

Event types should normalize:

- task started
- streaming text
- command planned
- command started
- command finished
- file changed
- diff ready
- approval requested
- task completed
- task failed
- task cancelled

## 11. Provider rollout

### Provider 1
Claude Code

Why first:

- likely strongest structured integration path
- best chance of getting a polished first adapter

### Provider 2
Codex CLI

Why second:

- likely strong local coding workflow fit
- useful to prove adapter abstraction is real

### Provider 3
OpenCode

Why third:

- adapter layer already proven by then
- easier to add once lifecycle model exists

## 12. Process model

Process ownership rules:

- provider tasks belong to workspace
- terminal sessions belong to workspace
- preview/dev server processes belong to workspace
- windows only render workspace state
- closing a window does not automatically destroy workspace-owned jobs/processes unless configured

## 13. Persistence

Persist at minimum:

- projects
- workspaces
- layout tree
- pane states
- job history
- notification history
- window ownership
- preview targets
- recent files opened in editor panes

Do not try to persist everything at first:

- full terminal scrollback can be bounded
- provider raw output can be summarized/compacted
- transient UI hover states should not persist

## 14. Security posture

Minimum acceptable posture:

- provider adapters run as explicit child processes
- clear allowlist/setting for executable paths
- preview limited to local/dev/runtime surfaces
- no arbitrary general browsing scope in preview
- clear labeling when a command is about to run
- command logs captured for review

## 15. Metrics worth collecting later

Only after core product is stable:

- workspace open count
- average concurrent jobs
- jump frequency between workspaces
- time from job completion to user focus
- preview usage frequency
- provider usage split
- pane type usage

Keep metrics optional and privacy-conscious.

## Interface controls

Use the installed HeroUI components for buttons, selects, switches, inputs, and other interactive controls. Reuse existing app components where they already wrap the library. Match spacing, elevation, focus states, and disabled states across settings and workspace panels.

## Spatial navigation

[Material Shell's spatial model](https://github.com/material-shell/material-shell#spatial-model) defines aIDE navigation:

- A project's workspaces form stable vertical rows. Alt+Up and Alt+Down select adjacent rows.
- Panes occupy stable horizontal positions within a workspace. Returning restores the selected pane and its position.
- Focusing a pane or workspace never changes its order. Explicit add, remove, or reorder actions change positions.
- Slides preserve direction and can reverse before they finish. Switching between projects does not animate through unrelated workspaces.
- Animation preferences support System default, On, and Reduced motion. Reduced motion preserves status and feedback without spatial movement.
- The left sidebar slides from the left and resizes the workspace. Its collapsed state leaves only the header toggle. The fleet drawer slides from the right and takes space from the workspace, capped at half its width.
