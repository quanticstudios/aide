# Product Decisions Locked From Discovery

This document captures the decisions that were already made during product exploration. These should be treated as default assumptions unless testing proves them wrong.

## 1. Product category

This product is a **cross-platform AI-native coding shell**.

It is not a classic IDE in the "editor is the center of everything" sense.

It is not a window manager.

It is not a generic terminal multiplexer.

It is not a browser shell.

It is a **workspace orchestration tool** for:

- AI-assisted coding
- terminal-heavy workflows
- multi-workspace operation
- git review
- preview/validation
- background job tracking

## 2. Core product thesis

The problem is not just editing code faster.

The problem is keeping track of:

- multiple active workspaces
- multiple terminals
- model runs
- git state
- local previews
- outputs that require human review

The app should reduce mental fragmentation between these surfaces.

## 3. Top-level user-facing object

The top-level working unit is **Workspace**.

A workspace:

- is the main thing the user opens, views, and switches to
- is self-contained
- owns its own pane layout
- owns its own jobs and notifications
- is typically backed by a Git worktree
- may only exist in **one window at a time**

## 4. Project vs workspace

`Project` exists, but it is not the live runtime container.

`Project` is grouping and metadata:

- repo identity
- remote URL
- canonical root
- list of workspaces
- shared settings
- grouping in sidebar and overview

`Workspace` is where actual work happens:

- chat
- terminal
- git
- preview
- editor
- jobs
- notifications
- layout

## 5. Terminology

User-facing term:

- **Workspace**

Internal term allowed:

- `worktree`

Reason:

- `worktree` is accurate internally
- `workspace` is better product language
- a workspace is more than just a checked-out filesystem path

## 6. Stack decision

Preferred shell: **Electron**

Rationale:

- cross-platform requirement is hard
- weight is not a primary concern
- battle-tested parts are preferred
- future multi-window support matters
- preview/web content support is easier with a Chromium-based shell
- battle-tested pane-heavy UI is easier in Electron than native-first

Non-goal:

- building a native desktop app first

## 7. Editor decision

Use **Monaco**.

The editor is not the core product, but it is still useful for:

- syntax-highlighted inspection
- basic edits
- diff review
- patch validation
- jumping to files referenced by chat/git/jobs

Non-goal:

- matching full VS Code or JetBrains editing power

## 8. Terminal decision

Use **xterm.js** with a PTY backend.

Terminal remains first-class because users must be able to:

- run arbitrary CLI tools
- inspect raw execution
- debug weird cases
- keep trust and control

Chat does not replace terminal.

## 9. Chat decision

Chat is first-class.

A **chat pane** belongs inside the workspace layout and is scoped to a workspace.

It is not:

- a global sidebar helper
- a provider-owned TUI
- a floating overlay

Chat should be the user’s main AI steering surface.

## 10. Git decision

Git is a core pane.

Reason:

- in AI-heavy development, git becomes the trust and review surface
- users need to understand what changed, not just that something ran

Git pane responsibilities:

- changed files
- staged/unstaged
- branch/workspace state
- diff viewing
- selective staging
- revert/discard flows
- commit trigger later

## 11. Preview decision

This product does **not** embed a full browser.

It embeds a **Preview** pane.

Preview is only for:

- localhost/dev server output
- project runtime surfaces
- app validation
- direct workflow surfaces related to the active workspace

It is not for:

- general browsing
- bookmarks
- multi-profile browsing
- replacing the user’s browser

## 12. Pane model

Default rule:

> Everything meaningful is a pane except modals.

Likely pane types:

- Chat
- Terminal
- Git
- Preview
- Jobs
- Logs
- Editor

Layout is tiling/split-based, not freeform-canvas-first.

## 13. Layout system

Use a layout tree:

- horizontal split
- vertical split
- pane leaf

Users must be able to:

- split left/right
- split up/down
- move panes
- resize panes
- close panes
- focus panes
- duplicate common pane combinations

Pane-local tab stacks are useful but should not replace the structural model.

## 14. Navigation rules

Locked navigation rules:

- **Left/right should only mean panes**
- project switching should use a different mechanism
- broader switching should use overview, sidebar, and hotkeys

Candidate navigation mapping:

- `Alt + Left/Right`: switch pane focus
- `Alt + Up/Down`: switch workspace within current project
- project switching via:
  - sidebar
  - overview switcher
  - direct jump hints

## 15. Sidebar decision

There should always be a visible sidebar rail.

Behavior:

- collapsed by default
- expandable on hover
- pinnable open
- keyboard-focusable

Sidebar shows:

- projects
- workspaces
- status badges
- active/running job signals
- current selection
- quick actions

Hover is convenience, not the only access path.

## 16. Overview / switcher decision

There should be an overview-style switcher similar to an alt-tab / mission-control hybrid.

It should allow fast jump to:

- projects
- workspaces
- running/finished work

## 17. Direct project switching

When the user holds `Ctrl`, the sidebar should show numeric hints beside projects.

Example:

- hold `Ctrl`
- sidebar shows 1, 2, 3… next to visible projects
- tap number to jump directly to that project
- release `Ctrl` to hide hints

This is a quick project jump mechanism, not a general-purpose hint mode for the whole app.

## 18. Notification decision

Notifications are critical, not optional polish.

Notifications should be:

- workspace-scoped
- actionable
- low-friction
- persistent enough not to get lost
- visible across windows

Notification examples:

- model finished changes
- tests failed
- preview crashed
- git conflict occurred
- command completed

Clicking a notification should restore/focus the target workspace and optionally the relevant pane.

## 19. Multi-window decision

Multi-window support is needed later, especially for multi-monitor users.

Hard rule:

> A workspace may exist in only one window at a time.

Implications:

- window is a host for one or more workspaces
- workspace ownership is single-window
- no "same workspace mirrored in two windows" behavior in early versions

## 20. AI backend integration decision

The app should integrate:

- Claude Code
- Codex CLI
- OpenCode

But the app should **not** embed their TUIs.

The correct model is:

- app owns the chat pane
- provider CLIs/SDKs act as backends
- adapter layer normalizes them into one product experience

## 21. Integration rollout decision

Do not try to deeply integrate all providers at once.

Recommended rollout:

- define provider adapter abstraction first
- implement one backend fully
- add others after the abstraction survives real use

## 22. Product moat

The moat is not editor power.

The moat is:

- workspace model
- pane layout
- navigation
- job orchestration
- workspace-scoped notifications
- review flows
- provider adapter layer

## 23. Explicit non-goals for v1

Do not try to ship all of this in v1:

- full browser
- plugin marketplace
- collaboration
- cloud sync
- enterprise controls
- custom editor engine
- custom terminal engine
- same workspace in multiple windows
- full VS Code extension compatibility
